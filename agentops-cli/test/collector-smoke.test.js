const assert = require('node:assert/strict');
const test = require('node:test');

const { smokeCollector } = require('../src/lib/collector-smoke');

test('collector smoke skips poison checks when disabled and reports running health', async () => {
  const calls = [];

  const result = await smokeCollector({
    options: { mode: 'binary', privacy: 'compat', poison: false },
    findCollectorBinary: () => ({ ok: true, path: '/tmp/otelcol-contrib' }),
    status: async (options) => {
      calls.push({ status: options });
      return { running: true, health: { ok: true } };
    },
    runPoisonCheck: () => {
      calls.push('poison');
    },
    runRuntimePoisonSmoke: () => {
      calls.push('runtime');
    }
  });

  assert.deepEqual(result, {
    ok: true,
    privacyMode: 'compat',
    poison: null,
    runtime_validation: {
      status: 'collector-running',
      health: { ok: true },
      debug_exporter: null
    }
  });
  assert.deepEqual(calls, [{ status: { mode: 'binary', privacy: 'compat' } }]);
});
