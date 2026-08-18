'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const {
  MAX_EVENTS,
  benchmarkConfig,
  boundedCount,
  collectorBinaryPath,
  percentile,
  runCollectorBenchmark
} = require('../src/lib/collector-benchmark');

const binary = collectorBinaryPath();

test('collector benchmark helpers bound workloads and report nearest-rank percentiles', () => {
  assert.equal(boundedCount('25', 10), 25);
  assert.equal(boundedCount('bad', 10), 10);
  assert.equal(boundedCount('99999', 10), MAX_EVENTS);
  assert.equal(percentile([5, 1, 4, 2, 3], 0.50), 3);
  assert.equal(percentile([5, 1, 4, 2, 3], 0.95), 5);
});

test('collector benchmark config reuses strict processors and has only a loopback sink', () => {
  const config = benchmarkConfig({
    canonicalConfigPath: require('node:path').resolve(__dirname, '../../collector/otelcol.local.strict.yaml'),
    receiverPort: 14318,
    healthPort: 13133,
    sinkPort: 24318
  });
  assert.match(config, /transform\/privacy_strict:/);
  assert.match(config, /keep_keys\(attributes/);
  assert.match(config, /endpoint: http:\/\/127\.0\.0\.1:24318/);
  assert.doesNotMatch(config, /azuremonitor|APPLICATIONINSIGHTS|0\.0\.0\.0/);
});

test('real collector benchmark measures strict local receiver to sink path', {
  skip: !fs.existsSync(binary),
  timeout: 30000
}, async () => {
  const report = await runCollectorBenchmark({ events: 8, warmup: 2, collectorBinary: binary });
  assert.equal(report.methodology.events, 8);
  assert.equal(report.methodology.warmup_events, 2);
  assert.match(report.methodology.transport, /no Azure or external network writes/);
  assert.equal(report.receiver_acknowledgement.samples, 8);
  assert.equal(report.local_sink_acknowledgement.samples, 8);
  assert.equal(report.privacy_check.sink_requests, 8);
  assert.equal(report.privacy_check.allowlisted_event_id_present, true);
  assert.equal(report.privacy_check.disallowed_metadata_removed, true);
  assert.ok(report.receiver_acknowledgement.p50_ms >= 0);
  assert.ok(report.receiver_acknowledgement.p95_ms >= report.receiver_acknowledgement.p50_ms);
  assert.ok(report.local_sink_acknowledgement.p95_ms >= report.local_sink_acknowledgement.p50_ms);
});
