const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

function modulePath(relativePath) {
  return path.join(repoRoot, 'agentops-cli', relativePath);
}

function clearCollectorModules() {
  for (const relativePath of [
    'src/lib/paths.js',
    'src/lib/collector-runtime.js',
    'src/lib/collector-binary-runtime.js',
    'src/lib/collector-start.js',
    'src/lib/collector-manager.js'
  ]) {
    const absolutePath = modulePath(relativePath);
    delete require.cache[require.resolve(absolutePath)];
  }
}

function patch(object, property, value) {
  const original = object[property];
  object[property] = value;
  return () => {
    object[property] = original;
  };
}

test('collector binary start spawns the configured collector with strict config and connection string', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-collector-start-'));
  const fakeBinary = path.join(tempDir, 'otelcol-contrib');
  const originalEnv = {
    AGENTOPS_COLLECTOR_HOME: process.env.AGENTOPS_COLLECTOR_HOME,
    AGENTOPS_OTELCOL_BIN: process.env.AGENTOPS_OTELCOL_BIN,
    APPLICATIONINSIGHTS_CONNECTION_STRING: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  };
  const spawnCalls = [];
  let unrefCalled = false;

  try {
    fs.writeFileSync(fakeBinary, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(fakeBinary, 0o755);
    process.env.AGENTOPS_COLLECTOR_HOME = path.join(tempDir, 'collector-home');
    process.env.AGENTOPS_OTELCOL_BIN = fakeBinary;
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';

    clearCollectorModules();
    const runtime = require(modulePath('src/lib/collector-runtime.js'));
    const restore = [
      patch(runtime, 'healthCheck', async () => ({ ok: false })),
      patch(runtime, 'readPid', () => null),
      patch(runtime, 'findManagedCollectorProcess', () => null),
      patch(runtime, 'waitForHealth', async () => ({ ok: true, statusCode: 200 })),
      patch(childProcess, 'spawn', (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return {
          pid: 4321,
          unref() {
            unrefCalled = true;
          }
        };
      })
    ];

    try {
      const collectorManager = require(modulePath('src/lib/collector-manager.js'));
      const result = await collectorManager.start({ mode: 'binary', privacy: 'strict' });
      const config = collectorManager.configPathFor('binary', 'strict');

      assert.equal(result.ok, true);
      assert.equal(result.pid, 4321);
      assert.equal(spawnCalls.length, 1);
      assert.equal(spawnCalls[0].command, fakeBinary);
      assert.deepEqual(spawnCalls[0].args, ['--config', config]);
      assert.equal(spawnCalls[0].options.env.APPLICATIONINSIGHTS_CONNECTION_STRING, 'InstrumentationKey=test');
      assert.equal(unrefCalled, true);
    } finally {
      restore.reverse().forEach(fn => fn());
      clearCollectorModules();
    }
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
