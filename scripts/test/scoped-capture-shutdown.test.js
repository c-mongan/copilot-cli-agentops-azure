'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startScopedStrictCollector } = require('../../agentops-cli/src/lib/copilot/scoped-collector');
const { fixture, traceFixture, logFixture, verify, verifyTraces, verifyLogs } = require('../qualify-safe-metrics');

const binary = process.env.AGENTOPS_COLLECTOR_BINARY;
test('actual scoped Collector preserves all accepted signals through immediate shutdown', { skip: !binary, timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-shutdown-proof-'));
  let collector;
  try {
    collector = await startScopedStrictCollector({ tempRoot: root, findCollectorBinary: () => ({ ok: true, path: binary }) });
    for (const [signal, payload] of [['traces', traceFixture()], ['metrics', fixture()], ['logs', logFixture()]]) {
      const response = await fetch(`${collector.endpoint}/v1/${signal}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      assert.equal(response.status, 200);
    }
    // No receipt polling or delay: a short real command can exit immediately.
    await collector.stop({ remove: false });
    assert.equal(verifyTraces(collector.receiptPath), 9);
    assert.equal(verify(collector.receiptPath).length, 3);
    assert.equal(verifyLogs(collector.receiptPath), 1);
    assert.equal(fs.readFileSync(path.join(collector.directory, 'collector.log'), 'utf8').includes('secret-metrics-canary-do-not-export'), false);
  } finally {
    if (collector) await collector.stop({ remove: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
