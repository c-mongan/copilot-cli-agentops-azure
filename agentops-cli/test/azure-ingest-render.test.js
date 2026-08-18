const assert = require('node:assert/strict');
const test = require('node:test');

const {
  renderAzureIngestPlan,
  renderLogsIngestionUploadPlan,
  renderSharedStorageUploadPlan
} = require('../src/lib/azure/v2-ingest-render');

test('azure ingest render helpers format plan status tables commands and next steps', () => {
  const azure = renderAzureIngestPlan({
    ok: false,
    dir: '/tmp/agentops',
    privacy: { ok: false },
    content_capture: { rows: 2, allowed: true },
    schema_migration_policy: { migration_required: true, current_version: '2' },
    tables: {
      AgentOpsRunSummary_CL: {
        rows: 1,
        columns: ['RunId', 'TimeGenerated'],
        stream_name: 'Custom-AgentOpsRunSummary_CL'
      }
    },
    errors: ['missing DCR stream'],
    warnings: ['schema migration required'],
    next: ['agentops dashboard validate']
  });

  assert.match(azure, /AgentOps V2 Azure ingestion plan/);
  assert.match(azure, /Status: not ready/);
  assert.match(azure, /AgentOpsRunSummary_CL: 1 row\(s\), 2 column\(s\), stream Custom-AgentOpsRunSummary_CL/);
  assert.match(azure, /missing DCR stream/);

  const logs = renderLogsIngestionUploadPlan({
    ok: true,
    dir: '/tmp/agentops',
    endpoint: 'https://dce.example',
    dcr_immutable_id: 'dcr-abc',
    privacy: { ok: true },
    uploads: [{
      table: 'AgentOpsRunSummary_CL',
      rows: 1,
      stream: 'Custom-AgentOpsRunSummary_CL',
      command: ['az', 'rest', '--uri', 'https://dce.example/streams/Custom-AgentOpsRunSummary_CL']
    }],
    errors: [],
    warnings: [],
    next: ['agentops product audit --live']
  });

  assert.match(logs, /AgentOps Logs Ingestion upload plan/);
  assert.match(logs, /Endpoint: https:\/\/dce\.example/);
  assert.match(logs, /az rest --uri https:\/\/dce\.example\/streams\/Custom-AgentOpsRunSummary_CL/);

  const shared = renderSharedStorageUploadPlan({
    ok: true,
    dir: '/tmp/agentops',
    storage: { account: 'acct', container: 'agentops-shared' },
    privacy: { ok: true },
    artifacts: [{
      table: 'AgentOpsSavedViews_CL',
      rows: 1,
      blob: 'team/latest/AgentOpsSavedViews_CL/AgentOpsSavedViews_CL.jsonl',
      command: ['az', 'storage', 'blob', 'upload']
    }],
    errors: [],
    warnings: [],
    next: ['Review the artifact list and privacy scan.']
  });

  assert.match(shared, /AgentOps shared storage upload plan/);
  assert.match(shared, /Storage: acct\/agentops-shared/);
  assert.match(shared, /team\/latest\/AgentOpsSavedViews_CL\/AgentOpsSavedViews_CL\.jsonl/);
});
