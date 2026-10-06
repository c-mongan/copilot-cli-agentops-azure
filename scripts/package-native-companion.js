#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { dependencyClosure } = require('./package-native-extension');
const { managedPolicy } = require('../companion/src/server');
const runtimeEntries = ['copilot/scoped-collector.js', 'collector-binary-release.js', 'copilot/session-otel.js', 'copilot/session-span-export.js', 'copilot/delivery-limits.js'];
function regular(root, file) {
  const relative = path.relative(root, file);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Package source escapes root.');
  let cursor = root;
  for (const part of relative.split(path.sep)) { cursor = path.join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Package source contains symbolic links.'); }
  if (!fs.statSync(file).isFile()) throw new Error('Package source must be a regular file.');
}
function prepareNativeCompanionPackage({ sourceRoot = path.resolve(__dirname, '..'), outDir, platform = process.platform } = {}) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Supported companion targets are darwin and win32.');
  if (!outDir) throw new Error('A new output directory is required.');
  sourceRoot = path.resolve(sourceRoot); outDir = path.resolve(outDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'companion/package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) throw new Error('Invalid companion version.');
  const library = path.join(sourceRoot, 'agentops-cli/src/lib');
  const files = dependencyClosure(library, runtimeEntries);
  fs.mkdirSync(outDir);
  const appPath = path.join(outDir, platform === 'darwin' ? 'AgentOps Native Companion.app' : 'AgentOps Native Companion');
  const contents = platform === 'darwin' ? path.join(appPath, 'Contents') : appPath;
  const resources = platform === 'darwin' ? path.join(contents, 'Resources') : contents;
  const payload = path.join(resources, 'companion');
  const hashes = [];
  function copy(file, relative) {
    regular(sourceRoot, file);
    const target = path.join(payload, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target);
    hashes.push({ file: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  }
  copy(path.join(sourceRoot, 'companion/package.json'), 'package.json');
  for (const file of ['server.js', 'copilot-launch.js']) copy(path.join(sourceRoot, 'companion/src', file), path.join('src', file));
  for (const name of ['recorder.js', 'recorder-worker.js', 'library-report.js', 'capture-stages.js']) copy(path.join(sourceRoot, 'extensions/agentops-native/src', name), path.join('src', name));
  for (const file of files) copy(file, path.join('runtime/src/lib', path.relative(library, file)));
  for (const file of ['otelcol.local.strict.yaml', 'release-cadence.json']) copy(path.join(sourceRoot, 'collector', file), path.join('runtime/collector', file));
  copy(path.join(sourceRoot, 'LICENSE'), 'LICENSE');
  fs.writeFileSync(path.join(payload, 'runtime/package.json'), JSON.stringify({ name: 'copilot-agentops-cli', private: true, version: manifest.version }) + '\n');
  const setup = path.join(resources, 'setup'); fs.mkdirSync(setup, { recursive: true });
  fs.writeFileSync(path.join(setup, 'managed-settings.example.json'), JSON.stringify(managedPolicy(), null, 2) + '\n');
  fs.writeFileSync(path.join(setup, 'README.txt'), 'REVIEW ONLY. No device settings are installed by this app.\nAn enterprise administrator must merge telemetry into effective managed policy without discarding existing policy.\nmacOS target: /Library/Application Support/GitHubCopilot/managed-settings.json\nWindows target: %ProgramFiles%\\GitHubCopilot\\managed-settings.json\nOn macOS, the policy file must be regular, root owned, not a symbolic link, and not group/world writable. On Windows, use administrator-controlled policy permissions and verify them on a Windows host.\nRestart Copilot after policy activation. Keep the companion open while capture is needed.\nRemove only the exact owned telemetry values during rollback. Preserve later administrator changes.\nNo launch daemon, shell profile, Copilot config, or Azure destination is installed.\n');
  if (platform === 'darwin') {
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  const launcher = path.join(contents, 'MacOS', 'agentops-native-companion');
  fs.writeFileSync(launcher, `#!/bin/bash\nset -eu\nAPP_CONTENTS="$(cd "$(dirname "$0")/.." && pwd)"\nfor VSCODE_APP in "/Applications/Visual Studio Code.app" "/Applications/Visual Studio Code - Insiders.app" "$HOME/Applications/Visual Studio Code.app" "$HOME/Applications/Visual Studio Code - Insiders.app"; do\n  for VSCODE_RUNTIME in "$VSCODE_APP/Contents/MacOS/Electron" "$VSCODE_APP/Contents/MacOS/Code - Insiders"; do\n    if [ -x "$VSCODE_RUNTIME" ]; then\n      export ELECTRON_RUN_AS_NODE=1\n      exec "$VSCODE_RUNTIME" "$APP_CONTENTS/Resources/companion/src/server.js" "$@"\n    fi\n  done\ndone\n/usr/bin/osascript -e 'display alert "AgentOps needs an installed VS Code runtime" message "Install VS Code or VS Code Insiders in Applications. This preview does not require a separate Node runtime or AgentOps CLI."'\nexit 1\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>AgentOps Native Companion</string><key>CFBundleIdentifier</key><string>local.agentops.native-companion</string><key>CFBundleVersion</key><string>${manifest.version}</string><key>CFBundleShortVersionString</key><string>${manifest.version}</string><key>CFBundleExecutable</key><string>agentops-native-companion</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>\n`);
  } else {
    fs.writeFileSync(path.join(appPath, 'Start AgentOps.cmd'), '@echo off\r\nsetlocal\r\nset "ELECTRON_RUN_AS_NODE=1"\r\nfor %%R in ("%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe" "%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe" "%ProgramFiles%\\Microsoft VS Code\\Code.exe" "%ProgramFiles%\\Microsoft VS Code Insiders\\Code - Insiders.exe") do if exist %%R (\r\n  %%R "%~dp0companion\\src\\server.js" %*\r\n  exit /b\r\n)\r\necho AgentOps needs an installed VS Code runtime. No separate Node or AgentOps CLI is required.\r\npause\r\nexit /b 1\r\n');
  }
  const result = { appPath, version: manifest.version, platform, signed: false, prerequisite: 'Installed VS Code or VS Code Insiders; runtime reuse is preview-only', cloudPublishing: false, devicePolicyInstalled: false, receiverEndpoint: 'http://127.0.0.1:4318', payloadHashes: hashes };
  fs.writeFileSync(path.join(outDir, 'package-manifest.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (require.main === module) {
  try { const index = process.argv.indexOf('--out'); if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: node scripts/package-native-companion.js --out <new-directory>'); process.stdout.write(JSON.stringify(prepareNativeCompanionPackage({ outDir: process.argv[index + 1], ...(process.argv.includes('--platform') ? { platform: process.argv[process.argv.indexOf('--platform') + 1] } : {}) }), null, 2) + '\n'); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
module.exports = { prepareNativeCompanionPackage };
