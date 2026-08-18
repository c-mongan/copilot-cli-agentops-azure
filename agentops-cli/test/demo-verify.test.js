const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildDemoVerifyPayload } = require('../src/lib/demo-verify');

test('buildDemoVerifyPayload runs the local V2 control-room proof', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-demo-verify-'));
  try {
    const payload = buildDemoVerifyPayload({
      runs: 12,
      outDir: path.join(tempDir, 'demo'),
      insightsOutDir: path.join(tempDir, 'insights')
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.demo.runs, 12);
    assert.equal(payload.demo.table_counts.AgentOpsRecommendations_CL, 1);
    assert.ok(fs.existsSync(payload.insights.eval_file));
    assert.match(payload.open_links.links.replay, /agentops-v2-run-replay/);
    assert.match(payload.recommendation.artifact.file, /AgentOpsRecommendations_CL\.jsonl/);
    assert.ok(payload.next.some(command => command.includes('agentops azure-ingest plan')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
