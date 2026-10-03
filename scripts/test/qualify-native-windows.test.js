'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PINS, verifyDigest, commandLine, sourceClosure, nativeProof, qualifyWindows } = require('../qualify-native-windows');
test('downloads have fixed official URLs and both accepted digests and rejected corruption', async () => {
  assert.match(PINS.copilotUrl, /^https:\/\/registry\.npmjs\.org\/@github\/copilot-win32-x64\//);
  assert.match(PINS.vscodeUrl, /^https:\/\/vscode\.download\.prss\.microsoft\.com\//);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-win-digest-')); const file = path.join(root, 'fixture');
  try { fs.writeFileSync(file, 'fixture'); const expected = crypto.createHash('sha256').update('fixture').digest('hex'); assert.equal(await verifyDigest(file, 'sha256', expected), expected); await assert.rejects(verifyDigest(file, 'sha256', '0'.repeat(64)), /differs/); }
  finally { fs.rmSync(root, { recursive: true }); }
});
test('Windows qualification batch arguments reject expansion and preserve quoted paths', () => {
  assert.equal(commandLine('D:\\work space\\Start AgentOps.cmd', 'D:\\proof\\profile', 43190), '"D:\\work space\\Start AgentOps.cmd" --no-browser --port 43190 --storage "D:\\proof\\profile"');
  for (const value of ['D:\\unsafe&command', 'D:\\%SECRET%\\path', 'relative']) assert.throws(() => commandLine(value, 'D:\\profile', 43190));
  assert.throws(() => commandLine('D:\\app.cmd', 'D:\\profile', 0));
});
test('headless native proof separates capture, tool, console, desktop and Azure states', () => {
  const native = nativeProof({ code: 0, hasAgent: true, hasChat: true, hasTool: false, traceCount: 1, childrenHaveAgentParent: true, canaryAbsent: true, canaryObservedBeforeFilter: true, outputContainedCanary: false, operations: ['chat','invoke_agent'], spanCount: 2 });
  assert.equal(native.captureQualified, true); assert.equal(native.toolQualified, false); assert.equal(native.stdoutCanaryObserved, false); assert.equal(native.desktopBrowserQualified, false); assert.equal(native.azureQualified, false);
  assert.equal(nativeProof({ ...native, code: 0, hasAgent: true, hasChat: true, traceCount: 1, childrenHaveAgentParent: true, canaryAbsent: false, canaryObservedBeforeFilter: true }).captureQualified, false);
});
test('review closure exists and excludes user data, cloud policy, and generated graphs', () => {
  const root = path.resolve(__dirname, '../..'); const files = sourceClosure(root);
  assert.ok(files.includes('companion/src/server.js')); assert.ok(files.includes('scripts/qualify-native-cli.js'));
  for (const file of files) { assert.equal(fs.statSync(path.join(root, file)).isFile(), true, file); assert.doesNotMatch(file, /^(docs\/research|infra\/|graphify-out\/|\.agentops\/)/); }
});
test('non-Windows host is rejected before any download or output creation', { skip: process.platform === 'win32' && process.arch === 'x64' }, async () => {
  const root = path.join(os.tmpdir(), 'agentops-unsupported-' + crypto.randomUUID());
  await assert.rejects(qualifyWindows({outDir: root}), /Windows x64/); assert.equal(fs.existsSync(root), false);
});
