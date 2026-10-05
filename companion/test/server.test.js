'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { startCompanion, managedPolicy } = require('../src/server');
const base = require('../../extensions/agentops-native/src/recorder');
test('control server rejects foreign origins, forged hosts, unsafe requests; native endpoint is stable', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-companion-'));
  let starts = 0, stops = 0, launches = 0, received;
  const recorder = { ...base, startRecorder: async (_, options) => { starts++; received = options; return { endpoint: 'http://127.0.0.1:4318', receiptPath: '/not-read', stop: async () => { stops++; } }; } };
  const app = await startCompanion({ storage, recorder, launchCopilot: async () => { launches++; } });
  try {
    const page = await fetch(app.origin); const html = await page.text();
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const token = html.match(/const token="([a-f0-9]+)"/)[1];
    const headers = { Origin: app.origin, 'X-AgentOps-Token': token, 'Content-Type': 'application/json' };
    assert.equal((await fetch(app.origin + '/connect', { method: 'POST', headers: { ...headers, Origin: 'https://evil.invalid' }, body: '{}' })).status, 403);
    assert.equal((await fetch(app.origin + '/connect', { method: 'POST', headers: { ...headers, 'X-AgentOps-Token': 'forged' }, body: '{}' })).status, 403);
    assert.equal(await new Promise((resolve, reject) => { const req = http.request(app.origin + '/connect', { method: 'POST', headers: { ...headers, Host: 'evil.invalid', 'Content-Length': 2 } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); req.on('error', reject); req.end('{}'); }), 403);
    assert.equal((await fetch(app.origin + '/connect', { method: 'POST', headers, body: 'x'.repeat(1025) })).status, 413);
    assert.equal(starts, 0);
    assert.equal((await fetch(app.origin + '/start-copilot', { method: 'POST', headers, body: '{}' })).status, 409);
    assert.equal(launches, 0);
    assert.equal((await fetch(app.origin + '/connect', { method: 'POST', headers, body: '{}' })).status, 200);
    assert.deepEqual(received, { endpoint: 'http://127.0.0.1:4318' });
    const ready = await (await fetch(app.origin + '/status')).json();
    assert.equal(ready.connected, true);
    assert.deepEqual(ready.stages.map(stage => [stage.id, stage.state]), [['collector', 'ready'], ['nativeReceipt', 'none'], ['scriptReceipt', 'none'], ['upload', 'unavailable'], ['cloudReadback', 'unavailable']]);
    assert.match(html, /id="stages"/);
    assert.equal((await fetch(app.origin + '/connect', { method: 'POST', headers, body: '{}' })).status, 200);
    assert.equal(starts, 1);
    assert.equal((await fetch(app.origin + '/start-copilot', { method: 'POST', headers, body: '{}' })).status, 200);
    assert.equal(launches, 1);
    assert.equal((await fetch(app.origin + '/disconnect', { method: 'POST', headers, body: '{}' })).status, 200);
    assert.equal(stops, 1);
    assert.equal((await (await fetch(app.origin + '/status')).json()).connected, false);
  } finally { await app.close(); assert.equal(fs.existsSync(path.join(storage, 'native-capture.lock')), false); fs.rmSync(storage, { recursive: true }); }
});
test('policy is review-only supported managed telemetry with locked content off', () => {
  assert.deepEqual(managedPolicy(), { telemetry: { enabled: true, endpoint: 'http://127.0.0.1:4318', protocol: 'http/json', captureContent: false, lockCaptureContent: true, serviceName: 'github-copilot' } });
});
test('second owner cannot start, and close during setup stops the acquired Collector', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-companion-owner-'));
  let releaseStart, stops = 0;
  const ready = new Promise(resolve => { releaseStart = resolve; });
  const app = await startCompanion({ storage, recorder: { ...base, startRecorder: async () => { await ready; return { endpoint: 'http://127.0.0.1:4318', receiptPath: '/not-read', stop: async () => { stops++; } }; } } });
  try {
    await assert.rejects(startCompanion({ storage }), /owns native capture/);
    const token = (await (await fetch(app.origin)).text()).match(/const token="([a-f0-9]+)"/)[1];
    const action = fetch(app.origin + '/connect', { method: 'POST', headers: { Origin: app.origin, 'X-AgentOps-Token': token, 'Content-Type': 'application/json' }, body: '{}' });
    await new Promise(resolve => setTimeout(resolve, 20));
    const closed = app.close(); releaseStart(); await action; await closed;
    assert.equal(stops, 1);
  } finally { await app.close(); fs.rmSync(storage, { recursive: true }); }
});
test('close awaits aborted connect request and stops its eventual Collector', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-companion-abort-'));
  let releaseStart, began, stops = 0;
  const ready = new Promise(resolve => { releaseStart = resolve; });
  const started = new Promise(resolve => { began = resolve; });
  const app = await startCompanion({ storage, recorder: { ...base, startRecorder: async () => { began(); await ready; return { endpoint: 'http://127.0.0.1:4318', receiptPath: '/not-read', stop: async () => { stops++; } }; } } });
  try {
    const token = (await (await fetch(app.origin)).text()).match(/const token="([a-f0-9]+)"/)[1];
    const req = http.request(app.origin + '/connect', { method: 'POST', headers: { Origin: app.origin, 'X-AgentOps-Token': token, 'Content-Type': 'application/json', 'Content-Length': 2 } });
    req.on('error', () => {}); req.end('{}'); await started; req.destroy();
    let done = false; const closed = app.close().then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(done, false);
    releaseStart(); await closed; assert.equal(stops, 1);
  } finally { releaseStart(); await app.close(); fs.rmSync(storage, { recursive: true }); }
});

test('Quit closes idle keepalive and unused browser preconnect sockets within a bound', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-companion-idle-'));
  const app = await startCompanion({ storage });
  const agent = new http.Agent({ keepAlive: true });
  const preconnect = net.connect({ host: '127.0.0.1', port: Number(new URL(app.origin).port), allowHalfOpen: true });
  try {
    await new Promise((resolve, reject) => { preconnect.once('connect', resolve); preconnect.once('error', reject); });
    await new Promise((resolve, reject) => { const req = http.get(app.origin + '/status', { agent }, res => { res.resume(); res.once('end', resolve); }); req.once('error', reject); });
    let timeout;
    await Promise.race([app.close(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Idle sockets blocked companion shutdown.')), 1000); })]).finally(() => clearTimeout(timeout));
    assert.equal(fs.existsSync(path.join(storage, 'native-capture.lock')), false);
  } finally { preconnect.destroy(); agent.destroy(); await app.close(); fs.rmSync(storage, { recursive: true }); }
});
test('status reports a parsed native receipt as a separate stage without content', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-companion-stages-'));
  const receiptPath = path.join(storage, 'receipt.jsonl');
  fs.writeFileSync(receiptPath, JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: '00112233445566778899aabbccddeeff', spanId: '0011223344556677', name: 'secret prompt', startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000', attributes: [{ key: 'gen_ai.operation.name', value: { stringValue: 'chat' } }, { key: 'gen_ai.conversation.id', value: { stringValue: 'secret conversation' } }] }] }] }] }) + '\n', { mode: 0o600 });
  const app = await startCompanion({ storage, recorder: { ...base, startRecorder: async () => ({ endpoint: 'http://127.0.0.1:4318', receiptPath, stop: async () => {} }) } });
  try {
    const token = (await (await fetch(app.origin)).text()).match(/const token="([a-f0-9]+)"/)[1];
    assert.equal((await fetch(app.origin + '/connect', { method: 'POST', headers: { Origin: app.origin, 'X-AgentOps-Token': token, 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    const text = await (await fetch(app.origin + '/status')).text();
    const stages = Object.fromEntries(JSON.parse(text).stages.map(stage => [stage.id, stage]));
    assert.equal(stages.nativeReceipt.state, 'received'); assert.equal(stages.nativeReceipt.count, 1);
    assert.equal(stages.scriptReceipt.state, 'none'); assert.equal(stages.upload.state, 'unavailable');
    assert.doesNotMatch(text, /secret/);
  } finally { await app.close(); fs.rmSync(storage, { recursive: true }); }
});
