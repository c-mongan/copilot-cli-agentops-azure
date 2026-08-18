const assert = require('node:assert/strict');
const test = require('node:test');

const { stopCollector } = require('../src/lib/collector-stop');

test('collector stop orchestration dispatches binary mode with env privacy', () => {
  const calls = [];
  const result = stopCollector({
    options: { mode: 'auto' },
    env: {
      AGENTOPS_COLLECTOR_MODE: 'auto',
      AGENTOPS_PRIVACY_MODE: 'strict'
    },
    resolveAutoMode: () => ({ mode: 'binary' }),
    findCollectorBinary: () => ({ ok: true, path: '/tmp/otelcol-contrib' }),
    stopDocker: () => {
      calls.push('docker');
    },
    stopBinary: ({ privacy, findCollectorBinary }) => {
      calls.push({ privacy, binary: findCollectorBinary().path });
      return { ok: true, mode: 'binary', stopped: true };
    }
  });

  assert.deepEqual(result, { ok: true, mode: 'binary', stopped: true });
  assert.deepEqual(calls, [{ privacy: 'strict', binary: '/tmp/otelcol-contrib' }]);
});
