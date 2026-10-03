'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { launchScript, launchCopilotTerminal, windowsLaunchScript, nativeExecutable, resolveCopilotBinary } = require('../src/copilot-launch');
test('scoped Mac launch clears conflicting telemetry only in new process and quotes binary path', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-launch-'));
  try {
    const binary = path.join(root, "copilot's $(touch SHELL_ESCAPE_CANARY)");
    fs.writeFileSync(binary, '#!/bin/bash\nprintf "%s|%s|%s|%s" "$COPILOT_OTEL_ENABLED" "$COPILOT_OTEL_CAPTURE_CONTENT" "$OTEL_EXPORTER_OTLP_PROTOCOL" "${OTEL_EXPORTER_OTLP_TRACES_ENDPOINT-unset}"\n', { mode: 0o700 });
    const result = spawnSync('/bin/bash', ['-c', launchScript(binary)], { env: { HOME: root, COPILOT_OTEL_CAPTURE_CONTENT: 'true', OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://evil.invalid' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'true|false|http/json|unset');
    assert.equal(fs.existsSync(path.join(root, 'SHELL_ESCAPE_CANARY')), false);
    let received;
    const result2 = launchCopilotTerminal(root, { resolveBinary: () => binary, spawn: (command, args) => { received = { command, args }; return { status: 0 }; }, platform: 'darwin' });
    assert.equal(result2.launched, true); assert.deepEqual(received, { command: '/usr/bin/open', args: ['-a', 'Terminal', path.join(root, 'start-copilot.command')] });
    assert.equal(fs.statSync(path.join(root, 'start-copilot.command')).mode & 0o777, 0o700);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('Windows scoped launch rejects command injection and does not weaken execution policy', () => {
  const script = windowsLaunchScript('C:\\Users\\Example User\\copilot.exe');
  assert.match(script, /setlocal DisableDelayedExpansion/); assert.match(script, /COPILOT_OTEL_CAPTURE_CONTENT=false/);
  assert.doesNotMatch(script, /ExecutionPolicy|powershell|sudo/);
  for (const path of ['C:\\bad&command.exe', 'C:\\%SECRET%\\copilot.exe', 'C:\\bad"path.exe']) assert.throws(() => windowsLaunchScript(path));
});

test('Windows executable validation uses PE magic without Unix mode rejection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-win-binary-'));
  try {
    const binary = path.join(root, 'copilot.exe');
    fs.writeFileSync(binary, Buffer.from([0x4d, 0x5a, 0, 0]), { mode: 0o666 }); fs.chmodSync(binary, 0o666);
    assert.equal(nativeExecutable(binary, 'win32'), fs.realpathSync(binary));
    assert.equal(nativeExecutable(binary, 'darwin'), null);
    fs.writeFileSync(binary, '#!/bin/sh\necho unsafe');
    assert.equal(nativeExecutable(binary, 'win32'), null);
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('Windows PATH lookup accepts only absolute native copilot.exe candidates', () => {
  const seen = [];
  const binary = resolveCopilotBinary('win32', { lookup: () => ['copilot.exe', 'C:\\Users\\Example\\copilot.cmd', 'C:\\Users\\Example\\copilot.exe'], validateNative: (file, platform) => { seen.push([file, platform]); return file; } });
  assert.equal(binary, 'C:\\Users\\Example\\copilot.exe');
  assert.deepEqual(seen, [[binary, 'win32']]);
});
