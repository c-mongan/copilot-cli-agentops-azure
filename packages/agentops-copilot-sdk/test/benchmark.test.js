'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { percentile, positiveInteger, runBenchmark } = require('../benchmark/metadata-benchmark');

test('benchmark helpers have deterministic bounds and nearest-rank percentiles', () => {
  assert.equal(positiveInteger('25', 10), 25);
  assert.equal(positiveInteger('bad', 10), 10);
  assert.equal(positiveInteger('20000', 10), 10000);
  assert.equal(percentile([5, 1, 4, 2, 3], 0.50), 3);
  assert.equal(percentile([5, 1, 4, 2, 3], 0.95), 5);
});

test('metadata benchmark is bounded, local, content-free and reports descriptive p50/p95', async () => {
  let tick = 0;
  const requestBodies = [];
  const report = await runBenchmark({
    events: 12,
    warmup: 3,
    nowNs: () => { tick += 10000; return tick; },
    fetchImpl: async (_url, init) => {
      requestBodies.push(init.body);
      return { ok: true, status: 200 };
    }
  });

  assert.equal(report.methodology.events, 12);
  assert.equal(report.methodology.warmup_events, 3);
  assert.match(report.methodology.transport, /no network or Azure writes/);
  assert.equal(report.methodology.content_capture, 'off');
  assert.match(report.methodology.thresholds, /none/);
  assert.equal(report.capture.observed_events, 12);
  assert.equal(report.capture.latency_ms.p50, 0.01);
  assert.equal(report.capture.latency_ms.p95, 0.01);
  assert.equal(report.export.latency_ms.p50, 0.01);
  assert.equal(report.export.latency_ms.p95, 0.01);
  assert.equal(report.export.requests, 12);
  assert.equal(report.export.delivery.queuedInMemory, 12);
  assert.equal(report.export.delivery.collectorAccepted, 12);
  assert.equal(report.export.delivery.terminalFailures, 0);
  assert.equal(report.export.delivery.pendingInMemory, 0);
  assert.equal(requestBodies.length, 12);
  const attributeKeys = requestBodies.flatMap(body => (
    JSON.parse(body).resourceSpans[0].scopeSpans[0].spans[0].attributes.map(item => item.key)
  ));
  const forbiddenContentKeys = [
    'gen_ai.prompt', 'gen_ai.completion', 'gen_ai.tool.arguments', 'gen_ai.tool.result',
    'agentops.prompt.content', 'agentops.tool.payload'
  ];
  assert.deepEqual(attributeKeys.filter(key => forbiddenContentKeys.includes(key)), []);
});
