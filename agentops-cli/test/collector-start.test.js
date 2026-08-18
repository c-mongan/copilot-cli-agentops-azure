const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function modulePath(relativePath) {
  return path.join(repoRoot, 'agentops-cli', relativePath);
}

function clearCollectorStartModules() {
  for (const relativePath of [
    'src/lib/collector-start.js'
  ]) {
    const absolutePath = modulePath(relativePath);
    delete require.cache[require.resolve(absolutePath)];
  }
}

test('collector start orchestration reports already-running health when auto cannot resolve a runtime', async () => {
  clearCollectorStartModules();

  try {
    const { startCollector } = require(modulePath('src/lib/collector-start.js'));
    const health = { ok: true, statusCode: 200 };
    const calls = [];
    const result = await startCollector({
      options: { mode: 'auto', privacy: 'compat' },
      resolveAutoMode: () => ({ mode: null, reason: 'no local runtime' }),
      findCollectorBinary: () => ({ ok: false, error: 'test resolver: no local runtime' }),
      checkHealth: async () => health,
      startDocker: () => calls.push('docker'),
      startBinary: () => calls.push('binary')
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'auto');
    assert.equal(result.privacyMode, 'compat');
    assert.equal(result.alreadyRunning, true);
    assert.equal(result.health, health);
    assert.match(result.warning, /health endpoint is already responding/);
    assert.deepEqual(calls, []);
  } finally {
    clearCollectorStartModules();
  }
});
