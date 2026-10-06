'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { prepareNativeExtensionPackage, dependencyClosure } = require('../package-native-extension');
const repository = path.resolve(__dirname, '../..');
function fixture(root) {
  const source = path.join(root, 'source');
  const extension = path.join(source, 'extensions', 'agentops-native');
  fs.mkdirSync(path.join(extension, 'src'), { recursive: true });
  fs.cpSync(path.join(repository, 'agentops-cli', 'src', 'lib'), path.join(source, 'agentops-cli', 'src', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(source, 'instrumentation/auto'), { recursive: true });
  for (const name of ['plan.cjs', 'node.cjs', 'python.py', 'dependencies.json']) fs.copyFileSync(path.join(repository, 'instrumentation/auto', name), path.join(source, 'instrumentation/auto', name));
  fs.mkdirSync(path.join(source, 'collector'), { recursive: true });
  for (const file of ['otelcol.local.strict.yaml', 'release-cadence.json']) fs.copyFileSync(path.join(repository, 'collector', file), path.join(source, 'collector', file));
  fs.writeFileSync(path.join(extension, 'package.json'), JSON.stringify({ name: 'agentops-native', publisher: 'agentops', displayName: 'AgentOps Native', version: '0.1.0', main: './src/extension.js', engines: { vscode: '^1.99.0' } }));
  fs.writeFileSync(path.join(extension, 'src', 'extension.js'), "module.exports = require('./recorder');\n");
  for (const file of ['recorder.js', 'recorder-worker.js', 'library-report.js']) fs.copyFileSync(path.join(repository, 'extensions/agentops-native/src', file), path.join(extension, 'src', file));
  fs.writeFileSync(path.join(extension, 'README.md'), 'Public setup instructions.');
  fs.writeFileSync(path.join(extension, 'LICENSE'), 'MIT');
  fs.mkdirSync(path.join(extension, 'src', 'test'));
  fs.writeFileSync(path.join(extension, 'src', 'test', 'private.js'), 'SECRET_PACKAGE_CANARY');
  fs.writeFileSync(path.join(source, 'private.json'), 'SECRET_PACKAGE_CANARY');
  return source;
}
test('VSIX resolves recorder modules and strict assets after original source is removed', () => {
  const root = fs.mkdtempSync(path.join(process.env.AGENTOPS_TEST_TMP || os.tmpdir(), 'agentops-vsix-'));
  try {
    const source = fixture(root);
    const result = prepareNativeExtensionPackage({ sourceRoot: source, outDir: path.join(root, 'package') });
    const listing = spawnSync('unzip', ['-Z1', result.vsixPath], { encoding: 'utf8' });
    assert.equal(listing.status, 0, listing.stderr);
    assert.ok(listing.stdout.includes('extension.vsixmanifest'));
    assert.ok(listing.stdout.includes('extension/src/recorder-worker.js'));
    assert.ok(listing.stdout.includes('extension/runtime/src/lib/copilot/delivery-limits.js'));
    assert.ok(!listing.stdout.includes('/test/') && !listing.stdout.includes('private.json'));
    assert.ok(!listing.stdout.includes('/bin/') && !listing.stdout.includes('/evals/'));
    fs.rmSync(source, { recursive: true });
    const extracted = path.join(root, 'extracted');
    const unzip = spawnSync('unzip', ['-q', result.vsixPath, '-d', extracted], { encoding: 'utf8' });
    assert.equal(unzip.status, 0, unzip.stderr);
    const runtime = path.join(extracted, 'extension', 'runtime');
    const probe = spawnSync(process.execPath, ['-e', `
      const path = require('node:path'); const fs = require('node:fs');
      const base = process.argv[1];
      for (const name of ['copilot/scoped-collector','collector-binary-release','copilot/session-otel','copilot/session-span-export']) require(path.join(base,'src/lib',name));
      const roots = require(path.join(base,'src/lib/paths'));
      if (fs.realpathSync(roots.repoRoot) !== fs.realpathSync(base)) throw Error('Runtime root differs');
      if (!fs.readFileSync(roots.collectorConfigPath({target:'local'}),'utf8').includes('transform/privacy_strict')) throw Error('Strict asset missing');
      const receipt = path.join(base,'empty-receipt.jsonl'); fs.writeFileSync(receipt, '');
      require(path.join(base,'../src/recorder')).reportReceipt(receipt);
      console.log(require(path.join(base,'src/lib/collector-binary-release')).collectorPackageInfo().version);
    `, runtime], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.match(probe.stdout, /\d+\.\d+\.\d+/);
    assert.equal(fs.readFileSync(path.join(runtime, 'collector', 'otelcol.local.strict.yaml'), 'utf8'), fs.readFileSync(path.join(repository, 'collector', 'otelcol.local.strict.yaml'), 'utf8'));
    assert.equal(fs.readFileSync(path.join(runtime, 'collector', 'release-cadence.json'), 'utf8'), fs.readFileSync(path.join(repository, 'collector', 'release-cadence.json'), 'utf8'));
    assert.throws(() => prepareNativeExtensionPackage({ sourceRoot: repository, outDir: path.join(root, 'package') }));
    assert.ok(fs.existsSync(result.vsixPath));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('dependency closure rejects dynamic imports, root escape, external packages and symlinks', () => {
  const root = fs.mkdtempSync(path.join(process.env.AGENTOPS_TEST_TMP || os.tmpdir(), 'agentops-vsix-bounds-'));
  try {
    const module = path.join(root, 'entry.js');
    for (const source of ["require(variable)", "require('../outside')", "require('third-party')"]) {
      fs.writeFileSync(module, source);
      assert.throws(() => dependencyClosure(root, ['entry.js']));
    }
    fs.writeFileSync(module, "require('./alias')");
    fs.writeFileSync(path.join(root, 'actual.js'), 'module.exports = 1');
    fs.symlinkSync(path.join(root, 'actual.js'), path.join(root, 'alias.js'));
    assert.throws(() => dependencyClosure(root, ['entry.js']), /symbolic links/);
    fs.writeFileSync(module, "// require(variable)\nconst fs = require('node:fs');\n/* require('third-party') */");
    assert.equal(dependencyClosure(root, ['entry.js']).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
