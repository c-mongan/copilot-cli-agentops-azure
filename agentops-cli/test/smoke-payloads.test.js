const assert = require('node:assert/strict');
const test = require('node:test');

const {
  liveReplayGrafanaUrl,
  otlpAttributionSmokeTracePayload,
  smokeAzureQuery
} = require('../src/lib/smoke-payloads');

test('smoke payload helpers build metadata-only payloads and links', () => {
  const payload = otlpAttributionSmokeTracePayload('agentops-attribution-smoke-test', Date.parse('2026-05-26T12:00:00Z'));
  const spans = payload.resourceSpans[0].scopeSpans[0].spans;
  const query = smokeAzureQuery('agentops-attribution-smoke-test', '30m');
  const url = liveReplayGrafanaUrl('agentops-live-replay-smoke-test', '30m', {
    grafanaBaseUrl: 'https://grafana.example'
  });

  assert.equal(spans.length, 4);
  assert.match(JSON.stringify(payload), /content\.capture\.enabled/);
  assert.doesNotMatch(JSON.stringify(payload), /prompt|response|tool arguments/i);
  assert.match(query, /ago\(30m\)/);
  assert.match(query, /agentops-attribution-smoke-test/);
  assert.match(url, /agentops-live-replay/);
  assert.match(url, /var-conversation=agentops-live-replay-smoke-test/);
});
