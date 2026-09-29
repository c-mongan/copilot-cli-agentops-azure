const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildAzureIngestPlan, buildLogsIngestionUploadPlan } = require('../src/lib/azure/v2-ingest-plan');
const { runLogsIngestionUpload } = require('../src/lib/azure/logs-ingestion-upload');

test('content-only plan selects one synthetic content stream and requires explicit opt-in', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-content-plan-'));
  try {
    fs.writeFileSync(path.join(directory, 'AgentOpsContent_CL.jsonl'), `${JSON.stringify({
      TimeGenerated: '2026-01-01T00:00:00Z', RunId: 'synthetic', SessionId: 'synthetic', TraceId: '',
      Role: 'user', ContentKind: 'prompt', CaptureMode: 'full', PromptText: 'invented fixture', SchemaVersion: '2'
    })}\n`);
    const denied = buildAzureIngestPlan({ dir: directory, contentOnly: true });
    assert.equal(denied.ok, false);
    assert.match(denied.errors.join(' '), /requires --allow-content/);
    const approved = buildAzureIngestPlan({ dir: directory, contentOnly: true, allowContent: true });
    assert.equal(approved.ok, true);
    assert.deepEqual(Object.keys(approved.tables), ['AgentOpsContent_CL']);
    const upload = buildLogsIngestionUploadPlan({
      dir: directory, contentOnly: true, allowContent: true,
      endpoint: 'https://example.ingest.monitor.azure.com', dcrImmutableId: 'dcr-test'
    });
    assert.equal(upload.ok, true);
    assert.deepEqual(upload.uploads.map(item => item.table), ['AgentOpsContent_CL']);
    const unsafe = buildLogsIngestionUploadPlan({
      dir: directory, contentOnly: true, allowContent: true,
      endpoint: 'https://attacker.example', dcrImmutableId: 'dcr-test'
    });
    assert.equal(unsafe.ok, false);
    assert.match(unsafe.errors.join(' '), /Azure public Monitor ingestion endpoint/);
    const calls = [];
    const result = runLogsIngestionUpload(upload, {
      expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
      approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
      spawnSync(command, args) {
        calls.push([command, args]);
        if (args[0] === 'account') return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls[0][1].slice(0, 4), ['account', 'show', '--subscription', '11111111-1111-4111-8111-111111111111']);
    assert.deepEqual(calls[1][1].slice(0, 3), ['rest', '--subscription', '11111111-1111-4111-8111-111111111111']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
