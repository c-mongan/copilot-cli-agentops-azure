#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');
const { spawnSync } = require('node:child_process');

const runtimeEntries = [
  'copilot/scoped-collector.js', 'collector-binary-release.js',
  'copilot/session-otel.js', 'copilot/session-span-export.js', 'copilot/delivery-limits.js',
  'azure/logs-ingestion-upload.js', 'azure/durable-evidence-spool.js', 'copilot/session-delivery-outbox.js'
];
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));

function within(root, file) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error(`Module escapes package root: ${file}`);
  return relative;
}
function regularFile(root, file) {
  within(root, file);
  let cursor = root;
  for (const part of path.relative(root, file).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Package source must not contain symbolic links: ${cursor}`);
  }
  if (!fs.statSync(file).isFile()) throw new Error(`Package source is not a regular file: ${file}`);
}
function staticRequires(source, file) {
  // Remove comments, while preserving quoted strings and their escapes.
  const text = source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match, quoted) => quoted || ' ');
  const requires = [];
  for (const match of text.matchAll(/\brequire\s*(?:\.resolve\s*)?\(([^)]*)\)/g)) {
    const literal = match[1].trim().match(/^(['"])([^'"\\]+)\1$/);
    if (!literal) throw new Error(`Unsupported dynamic require in ${file}: ${match[0]}`);
    requires.push(literal[2]);
  }
  return requires;
}
function resolveLocal(root, from, request) {
  const base = path.resolve(path.dirname(from), request);
  within(root, base);
  for (const candidate of [base, base + '.js', base + '.json', path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      regularFile(root, candidate);
      return candidate;
    }
  }
  throw new Error(`Cannot resolve ${request} from ${from}`);
}
function dependencyClosure(root, entries) {
  const found = new Set();
  const pending = entries.map(entry => resolveLocal(root, path.join(root, '_entry.js'), './' + entry));
  while (pending.length) {
    const file = pending.pop();
    if (found.has(file)) continue;
    found.add(file);
    if (file.endsWith('.json')) continue;
    for (const request of staticRequires(fs.readFileSync(file, 'utf8'), file)) {
      if (request.startsWith('.')) pending.push(resolveLocal(root, file, request));
      else if (!builtins.has(request.replace(/^node:/, ''))) throw new Error(`Unsupported external dependency ${request} in ${file}`);
    }
  }
  return [...found].sort();
}
const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
function prepareNativeExtensionPackage({ sourceRoot = path.resolve(__dirname, '..'), outDir, extraRuntimeEntries = [] } = {}) {
  if (!outDir) throw new Error('A new --out directory is required.');
  sourceRoot = path.resolve(sourceRoot);
  outDir = path.resolve(outDir);
  const extensionRoot = path.join(sourceRoot, 'extensions', 'agentops-native');
  const manifestFile = path.join(extensionRoot, 'package.json');
  regularFile(extensionRoot, manifestFile);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (![manifest.name, manifest.publisher].every(value => /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(value || '')) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version || '')) throw new Error('Extension name, publisher, or version is invalid.');
  if (!manifest.displayName || !manifest.engines?.vscode || !manifest.main) throw new Error('Extension displayName, engines.vscode, and main are required.');
  const main = resolveLocal(extensionRoot, path.join(extensionRoot, '_entry.js'), manifest.main.startsWith('.') ? manifest.main : './' + manifest.main);
  if (!within(extensionRoot, main).startsWith('src' + path.sep)) throw new Error('Extension main must be inside src.');
  if (Object.keys(manifest.dependencies || {}).length) throw new Error('Extension runtime dependencies must be bundled explicitly.');
  const extensionFiles = [manifestFile];
  for (const name of ['README.md', 'LICENSE']) {
    const file = path.join(extensionRoot, name);
    extensionFiles.push(name === 'LICENSE' && !fs.existsSync(file) ? path.join(sourceRoot, name) : file);
  }
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['test', 'tests', '__tests__', 'node_modules'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Package source must not contain symbolic links: ${file}`);
      if (entry.isDirectory()) visit(file);
      else if (/\.(js|json)$/.test(entry.name) && !/\.(test|spec)\.js$/.test(entry.name)) extensionFiles.push(file);
    }
  }
  visit(path.join(extensionRoot, 'src'));
  const libRoot = path.join(sourceRoot, 'agentops-cli', 'src', 'lib');
  const entries = [...runtimeEntries, ...extraRuntimeEntries];
  const sourceFallbacks = new Set(runtimeEntries.map(entry => '../../../agentops-cli/src/lib/' + entry.replace(/\.js$/, '')));
  for (const file of extensionFiles.filter(file => file.endsWith('.js'))) {
    for (const request of staticRequires(fs.readFileSync(file, 'utf8'), file)) {
      if (request === 'vscode' || builtins.has(request.replace(/^node:/, ''))) continue;
      if (!request.startsWith('.')) throw new Error(`Unsupported extension dependency ${request}`);
      const resolved = path.resolve(path.dirname(file), request);
      const runtimeRoot = path.join(extensionRoot, 'runtime', 'src', 'lib');
      if (resolved.startsWith(runtimeRoot + path.sep)) entries.push(within(runtimeRoot, resolved));
      else if (request === '../../../instrumentation/auto/plan.cjs') {
        regularFile(sourceRoot, path.join(sourceRoot, 'instrumentation/auto/plan.cjs'));
      } else if (resolved.startsWith(path.join(extensionRoot, 'runtime/instrumentation/auto') + path.sep)) {
        const relative = path.relative(path.join(extensionRoot, 'runtime/instrumentation/auto'), resolved);
        regularFile(sourceRoot, path.join(sourceRoot, 'instrumentation/auto', relative));
      } else if (sourceFallbacks.has(request)) {
        regularFile(libRoot, path.join(libRoot, request.slice('../../../agentops-cli/src/lib/'.length) + '.js'));
      } else resolveLocal(extensionRoot, file, request);
    }
  }
  const closure = dependencyClosure(libRoot, entries);
  fs.mkdirSync(outDir); // Do not overwrite an existing output or delete it on failure.
  const stage = path.join(outDir, 'content');
  const extension = path.join(stage, 'extension');
  const copy = (source, relative) => {
    regularFile(sourceRoot, source);
    const destination = path.join(extension, relative);
    within(extension, destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  };
  for (const file of extensionFiles) copy(file, file.startsWith(extensionRoot + path.sep) ? within(extensionRoot, file) : path.basename(file));
  for (const file of closure) copy(file, path.join('runtime', 'src', 'lib', within(libRoot, file)));
  for (const asset of ['collector/otelcol.local.strict.yaml', 'collector/release-cadence.json']) copy(path.join(sourceRoot, asset), path.join('runtime', asset));
  for (const asset of ['plan.cjs', 'node.cjs', 'python.py', 'dependencies.json']) copy(path.join(sourceRoot, 'instrumentation/auto', asset), path.join('runtime/instrumentation/auto', asset));
  fs.writeFileSync(path.join(extension, 'runtime', 'package.json'), JSON.stringify({ name: 'copilot-agentops-cli', private: true, version: manifest.version }) + '\n');
  fs.writeFileSync(path.join(stage, '[Content_Types].xml'), '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="yaml" ContentType="text/yaml"/><Default Extension="xml" ContentType="text/xml"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>');
  fs.writeFileSync(path.join(stage, 'extension.vsixmanifest'), `<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${xml(manifest.name)}" Version="${xml(manifest.version)}" Publisher="${xml(manifest.publisher)}"/><DisplayName>${xml(manifest.displayName)}</DisplayName><Description xml:space="preserve">${xml(manifest.description || manifest.displayName)}</Description><Tags>opentelemetry,copilot</Tags><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(manifest.engines.vscode)}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/></Assets></PackageManifest>`);
  const vsixPath = path.join(outDir, `${manifest.publisher}.${manifest.name}-${manifest.version}.vsix`);
  const zip = spawnSync('zip', ['-q', '-X', '-r', vsixPath, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], { cwd: stage, encoding: 'utf8' });
  if (zip.error || zip.status !== 0) throw new Error(`VSIX zip failed: ${zip.error?.message || zip.stderr}`);
  return { ok: true, vsixPath, contentDir: stage, runtimeFiles: closure.map(file => within(libRoot, file)) };
}
if (require.main === module) {
  try {
    const index = process.argv.indexOf('--out');
    if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: node scripts/package-native-extension.js --out <new-directory>');
    process.stdout.write(JSON.stringify(prepareNativeExtensionPackage({ outDir: process.argv[index + 1] }), null, 2) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { prepareNativeExtensionPackage, dependencyClosure, staticRequires };
