#!/usr/bin/env node
'use strict';
// Local fixtures only. No model, cloud service, download or profile write.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const CANARY = 'secret-metrics-canary-do-not-export';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
function attributes(values) { return Object.entries(values).map(([key, value]) => ({ key, value: typeof value === 'boolean' ? { boolValue: value } : { stringValue: value } })); }
function poisonMetadata(payload, signal) {
  for (const group of payload[`resource${signal}`]) {
    group.schemaUrl = `https://${CANARY}.invalid/resource`;
    for (const scope of group[`scope${signal}`]) {
      scope.schemaUrl = `https://${CANARY}.invalid/scope`;
      scope.scope = { name: CANARY, version: CANARY, attributes: attributes({ private: CANARY }) };
    }
  }
  return payload;
}
function fixture() {
  const hist = (name, unit, labels = {}) => ({ name, unit, description: CANARY, histogram: { aggregationTemporality: 2, dataPoints: [{ attributes: attributes(labels), startTimeUnixNano: '1000000000', timeUnixNano: '2000000000', count: '2', sum: 3, bucketCounts: ['1', '1'], explicitBounds: [1] }] } });
  const counter = { name: 'github.copilot.tool.call.count', unit: 'calls', description: CANARY, sum: { isMonotonic: true, aggregationTemporality: 2, dataPoints: [{ timeUnixNano: '2000000000', asInt: '4', attributes: attributes({ success: true, private: CANARY }) }] } };
  const poisonedExemplar = hist('gen_ai.client.operation.duration', 's');
  poisonedExemplar.histogram.dataPoints[0].exemplars = [{ filteredAttributes: attributes({ private: CANARY }), timeUnixNano: '2000000000', asDouble: 1 }];
  return poisonMetadata({ resourceMetrics: [{ resource: { attributes: attributes({ 'service.name': 'qualification', private: CANARY }) }, scopeMetrics: [{ scope: { name: 'qualification' }, metrics: [
    hist('gen_ai.client.token.usage', 'tokens', { 'gen_ai.token.type': 'input', 'gen_ai.operation.name': 'chat', private: CANARY }),
    hist('gen_ai.client.operation.duration', 's', { 'gen_ai.operation.name': CANARY, 'gen_ai.token.type': CANARY, success: CANARY }),
    counter, poisonedExemplar,
    hist(CANARY, 's'), hist('gen_ai.client.token.usage', CANARY),
    { ...counter, name: 'gen_ai.client.token.usage', unit: 'tokens' },
  ] }] }] }, 'Metrics');
}
function traceFixture() {
  const span = (id, values) => ({ traceId: '11111111111111111111111111111111', spanId: id, name: CANARY, kind: 3, startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000', traceState: `private=${CANARY}`, status: { code: 2, message: CANARY }, attributes: attributes({ ...values, 'url.full': CANARY, 'db.query.text': CANARY, 'http.request.body.content': CANARY, 'http.request.header.authorization': CANARY }) });
  const linked = span('4444444444444444', { 'http.request.method': 'GET' });
  linked.links = [{ traceId: '22222222222222222222222222222222', spanId: '5555555555555555', attributes: attributes({ private: CANARY }), traceState: `private=${CANARY}` }];
  return poisonMetadata({ resourceSpans: [{ resource: { attributes: attributes({ 'service.name': 'qualification' }) }, scopeSpans: [{ scope: { name: 'qualification' }, spans: [
    span('1111111111111111', { 'http.request.method': 'GET', 'agentops.operation.kind': CANARY }),
    span('2222222222222222', { 'db.system.name': 'postgresql', 'agentops.operation.kind': CANARY }),
    linked,
    span('3333333333333333', { 'http.request.method': CANARY, 'db.system.name': CANARY, 'agentops.operation.kind': CANARY }),
  ] }] }] }, 'Spans');
}
function logFixture() {
  return poisonMetadata({ resourceLogs: [{ resource: { attributes: attributes({ 'service.name': 'qualification' }) }, scopeLogs: [{ logRecords: [{ timeUnixNano: '2000000000', severityNumber: 9, severityText: CANARY, eventName: CANARY, body: { stringValue: CANARY }, attributes: attributes({ private: CANARY }) }] }] }] }, 'Logs');
}
function verifyLogs(receipt) {
  const logs = fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).flatMap(line => JSON.parse(line).resourceLogs || []).flatMap(r => r.scopeLogs || []).flatMap(s => s.logRecords || []);
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].severityText);
  assert.equal(logs[0].eventName, 'agentops.event');
  assert.equal(logs[0].body.stringValue, 'redacted by AgentOps strict privacy mode');
  assert.equal((logs[0].attributes || []).length, 0);
  return logs.length;
}
function verifyTraces(receipt) {
  const spans = fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).flatMap(line => JSON.parse(line).resourceSpans || []).flatMap(r => r.scopeSpans || []).flatMap(s => s.spans || []);
  assert.equal(spans.length, 3);
  for (const span of spans) { assert.equal(span.name, 'agentops.span'); assert.equal(span.status.message, 'redacted by AgentOps strict privacy mode'); assert.ok(!span.traceState); assert.ok(!(span.links || []).length); }
  const values = span => Object.fromEntries((span.attributes || []).map(a => [a.key, a.value.stringValue ?? a.value.boolValue]));
  assert.deepEqual(values(spans[0]), { 'http.request.method': 'GET', 'agentops.operation.kind': 'http', 'agentops.content_capture.signal': true });
  assert.deepEqual(values(spans[1]), { 'db.system.name': 'postgresql', 'agentops.operation.kind': 'database', 'agentops.content_capture.signal': true });
  assert.deepEqual(values(spans[2]), { 'agentops.content_capture.signal': true });
  return spans.length;
}
function readMetrics(receipt) {
  return fs.readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean).flatMap(line => JSON.parse(line).resourceMetrics || []).flatMap(r => r.scopeMetrics || []).flatMap(s => s.metrics || []);
}
function verify(receipt) {
  const raw = fs.readFileSync(receipt, 'utf8');
  assert.equal(raw.includes(CANARY), false, 'Canary must not reach durable receipt');
  const metrics = readMetrics(receipt);
  assert.equal(metrics.length, 3, 'Only exact known name/type/unit instruments remain');
  assert.deepEqual(metrics.map(m => m.name).sort(), ['gen_ai.client.operation.duration', 'gen_ai.client.token.usage', 'github.copilot.tool.call.count']);
  const token = metrics.find(m => m.name === 'gen_ai.client.token.usage');
  assert.equal(token.unit, 'tokens'); assert.equal(token.histogram.dataPoints[0].sum, 3);
  assert.deepEqual(token.histogram.dataPoints[0].attributes, attributes({ 'gen_ai.token.type': 'input', 'gen_ai.operation.name': 'chat' }));
  const duration = metrics.find(m => m.name === 'gen_ai.client.operation.duration');
  assert.equal(duration.unit, 's'); assert.equal(duration.histogram.dataPoints[0].count, '2');
  assert.equal((duration.histogram.dataPoints[0].attributes || []).length, 0);
  for (const metric of metrics) {
    assert.ok(!metric.description);
    for (const point of (metric.histogram || metric.sum).dataPoints) assert.equal((point.exemplars || []).length, 0);
  }
  const counter = metrics.find(m => m.sum);
  assert.equal(counter.sum.isMonotonic, true);
  assert.equal(counter.sum.aggregationTemporality, 2);
  assert.equal(counter.sum.dataPoints[0].asInt, '4');
  assert.deepEqual(counter.sum.dataPoints[0].attributes, attributes({ success: true }));
  return metrics;
}
async function qualify({ binary = process.env.AGENTOPS_COLLECTOR_BINARY || path.join(os.homedir(), '.agentops/collector/bin/otelcol-contrib'), outputDirectory } = {}) {
  assert.match(execFileSync(binary, ['--version'], { encoding: 'utf8' }), /0\.151\.0\b/, 'Use the pinned cached Collector');
  const directory = outputDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-safe-metrics-'));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const [http, grpc, relay, health] = await Promise.all([port(), port(), port(), port()]);
  const receipt = path.join(directory, 'receipt.json');
  const source = fs.readFileSync(path.join(__dirname, '../collector/otelcol.local.strict.yaml'), 'utf8');
  const config = source.replaceAll('127.0.0.1:4318', `127.0.0.1:${http}`).replaceAll('127.0.0.1:4317', `127.0.0.1:${grpc}`).replaceAll('127.0.0.1:4319', `127.0.0.1:${relay}`).replaceAll('127.0.0.1:13133', `127.0.0.1:${health}`).replace('  batch: {}', '  batch:\n    timeout: 100ms');
  fs.writeFileSync(path.join(directory, 'collector.yaml'), config, { mode: 0o600 });
  const child = spawn(binary, ['--config', path.join(directory, 'collector.yaml')], { env: { ...process.env, AGENTOPS_OTEL_STORAGE_DIR: path.join(directory, 'queue'), AGENTOPS_OTEL_RECEIPT_PATH: receipt }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error(`Collector exited: ${log}`);
      try { ready = (await fetch(`http://127.0.0.1:${health}`, { signal: AbortSignal.timeout(200) })).ok; } catch {}
      if (ready) break; await sleep(50);
    }
    assert.ok(ready, 'Collector health');
    const response = await fetch(`http://127.0.0.1:${http}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fixture()) });
    assert.equal(response.status, 200, `OTLP response: ${await response.clone().text()}`); const accepted = await response.json();
    assert.ok(!accepted.partialSuccess?.rejectedDataPoints, 'No OTLP rejection');
    for (let i = 0; i < 100; i++) { if (fs.existsSync(receipt) && fs.statSync(receipt).size) break; await sleep(50); }
    const traceResponse = await fetch(`http://127.0.0.1:${http}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(traceFixture()) });
    assert.equal(traceResponse.status, 200);
    for (let i = 0; i < 100; i++) { if (fs.readFileSync(receipt, 'utf8').includes('resourceSpans')) break; await sleep(50); }
    const approvedSpanCount = verifyTraces(receipt);
    const logResponse = await fetch(`http://127.0.0.1:${http}/v1/logs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(logFixture()) });
    assert.equal(logResponse.status, 200);
    for (let i = 0; i < 100; i++) { if (fs.readFileSync(receipt, 'utf8').includes('resourceLogs')) break; await sleep(50); }
    const approvedLogCount = verifyLogs(receipt);
    const metrics = verify(receipt);
    // The production relay receives the already filtered payload and applies
    // the same filter and transform again. Exact labels/numeric data above
    // prove that the double pass preserves the approved semantics.
    assert.equal(log.includes(CANARY), false, 'Canary must not reach debug exporter');
    const result = { collectorVersion: '0.151.0', approvedMetricCount: metrics.length, approvedSpanCount, approvedLogCount, doubleTransform: true, canaryAbsent: true, outputDirectory: directory };
    fs.writeFileSync(path.join(directory, 'proof.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (child.exitCode === null) { child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)); }
  }
}
module.exports = { fixture, traceFixture, logFixture, verify, verifyTraces, verifyLogs, qualify };
if (require.main === module) qualify().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
