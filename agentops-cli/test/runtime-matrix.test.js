const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readRuntimeQualification, PINS, main } = require('../../scripts/check-runtime-matrix');

test('qualification keeps native SDK and Vally runtime identities separate', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-matrix-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'evals', 'stockpilot', 'node_modules', '@github', 'copilot-sdk');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@github/copilot-sdk', version: PINS.vallySdk }));
  const result = readRuntimeQualification({ root, env: { PATH: '' } });
  assert.equal(result.qualification, 'metadata_only');
  assert.equal(result.components.sdk.state, 'unavailable');
  assert.equal(result.components.vallySdk.state, 'matches_pin');
  assert.notEqual(result.pins.sdk, result.pins.vallySdk);
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@github/copilot-sdk', version: '9.9.9' }));
  assert.equal(readRuntimeQualification({ root, env: { PATH: '' } }).components.vallySdk.state, 'version_mismatch');
});

test('help has no runtime metadata or process execution side effects', () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const originalRead = fs.readFileSync;
  const originalWrite = process.stdout.write;
  let output = '';
  try {
    childProcess.spawn = childProcess.spawnSync = () => { throw new Error('help must not start processes'); };
    fs.readFileSync = () => { throw new Error('help must not inspect files'); };
    process.stdout.write = value => { output += value; return true; };
    main(['--help']);
    assert.match(output, /Read-only local runtime metadata/);
  } finally {
    childProcess.spawn = originalSpawn;
    childProcess.spawnSync = originalSpawnSync;
    fs.readFileSync = originalRead;
    process.stdout.write = originalWrite;
  }
});
