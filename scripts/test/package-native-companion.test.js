'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepareNativeCompanionPackage } = require('../package-native-companion');
test('macOS app contains a closed runtime, review-only policy and no global Node dependency', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-app-package-'));
  try {
    const result = prepareNativeCompanionPackage({ outDir: path.join(root, 'package'), platform: 'darwin' });
    const contents = path.join(result.appPath, 'Contents');
    const payload = path.join(contents, 'Resources/companion');
    const launcher = fs.readFileSync(path.join(contents, 'MacOS/agentops-native-companion'), 'utf8');
    assert.match(launcher, /ELECTRON_RUN_AS_NODE=1/); assert.doesNotMatch(launcher, /\bnpm\b|\bnode\b|sudo|launchctl/);
    assert.equal(result.signed, false); assert.equal(result.cloudPublishing, false); assert.equal(result.devicePolicyInstalled, false);
    const policy = JSON.parse(fs.readFileSync(path.join(contents, 'Resources/setup/managed-settings.example.json'), 'utf8'));
    assert.equal(policy.telemetry.lockCaptureContent, true);
    const probe = spawnSync(process.execPath, ['-e', "const path=require('node:path');const root=process.argv[1];require(path.join(root,'src/server'));require(path.join(root,'src/recorder'));require(path.join(root,'runtime/src/lib/copilot/scoped-collector'));", payload], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    for (const record of result.payloadHashes) assert.equal(fs.existsSync(path.join(payload, record.file)), true);
    assert.ok(!result.payloadHashes.some(record => /test|evals|private/.test(record.file)));
    assert.throws(() => prepareNativeCompanionPackage({ outDir: path.join(root, 'package'), platform: 'darwin' }), /EEXIST/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('Windows portable folder has installed VS Code launcher and the same closed runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-win-package-'));
  try {
    const result = prepareNativeCompanionPackage({ outDir: path.join(root, 'package'), platform: 'win32' });
    assert.equal(result.platform, 'win32');
    const launcher = fs.readFileSync(path.join(result.appPath, 'Start AgentOps.cmd'), 'utf8');
    assert.match(launcher, /ELECTRON_RUN_AS_NODE=1/); assert.match(launcher, /Code\.exe/);
    assert.doesNotMatch(launcher, /ExecutionPolicy|powershell|npm|sudo/);
    assert.ok(fs.existsSync(path.join(result.appPath, 'companion/src/copilot-launch.js')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.appPath, 'setup/managed-settings.example.json'), 'utf8')).telemetry.captureContent, false);
    assert.equal(fs.existsSync(path.join(result.appPath, 'Contents')), false);
  } finally { fs.rmSync(root, { recursive: true }); }
});
