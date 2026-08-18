const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createDurableLogsIngestionUploader,
  runLogsIngestionUpload
} = require('../src/lib/azure/logs-ingestion-upload');

function approvedSubscriptionSpawn(command, args) {
  assert.equal(command, 'az');
  assert.deepEqual(args, ['account', 'show', '--query', 'id', '-o', 'tsv']);
  return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
}

test('runLogsIngestionUpload converts JSONL rows, posts them, and removes the temporary payload', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-logs-ingestion-upload-'));
  try {
    const jsonlFile = path.join(tempDir, 'AgentOpsEvents_CL.jsonl');
    fs.writeFileSync(jsonlFile, `${JSON.stringify({ RunId: 'run-1', EventName: 'agent.start' })}\n`);
    const calls = [];
    let uploadedBody;
    let temporaryBodyFile;

    const result = runLogsIngestionUpload({
      ok: true,
      dir: tempDir,
      errors: [],
      uploads: [{
        table: 'AgentOpsEvents_CL',
        file: jsonlFile,
        uri: 'https://ingest.example/dataCollectionRules/dcr/streams/Custom-AgentOpsEvents_CL?api-version=2023-01-01',
        rows: 1
      }]
    }, {
      expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
      approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
      spawnSync(command, args) {
        calls.push([command, args]);
        if (args[0] === 'account') {
          return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
        }
        temporaryBodyFile = args.find(arg => String(arg).startsWith('@')).slice(1);
        uploadedBody = JSON.parse(fs.readFileSync(temporaryBodyFile, 'utf8'));
        return { status: 0, stdout: '', stderr: '' };
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.executed, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], ['az', ['account', 'show', '--query', 'id', '-o', 'tsv']]);
    assert.equal(calls[1][0], 'az');
    assert.ok(calls[1][1].includes('--resource'));
    assert.equal(uploadedBody[0].RunId, 'run-1');
    assert.equal(fs.existsSync(temporaryBodyFile), false);
    assert.equal(result.temporary_payloads_cleaned, true);
    assert.equal('body_file' in result.uploads[0], false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runLogsIngestionUpload removes temporary payloads when az upload fails', () => {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-logs-ingestion-failure-'));
  try {
    const jsonlFile = path.join(sourceDir, 'AgentOpsContent_CL.jsonl');
    fs.writeFileSync(jsonlFile, `${JSON.stringify({ Content: 'PRIVATE_REPRO_SENTINEL' })}\n`);
    let temporaryBodyFile;
    const result = runLogsIngestionUpload({
      ok: true,
      dir: sourceDir,
      errors: [],
      uploads: [{
        table: 'AgentOpsContent_CL',
        file: jsonlFile,
        uri: 'https://ingest.example/dataCollectionRules/dcr/streams/Custom-AgentOpsContent_CL?api-version=2023-01-01',
        rows: 1
      }]
    }, {
      expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
      approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
      spawnSync(_command, args) {
        if (args[0] === 'account') return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
        temporaryBodyFile = args.find(arg => String(arg).startsWith('@')).slice(1);
        assert.match(fs.readFileSync(temporaryBodyFile, 'utf8'), /PRIVATE_REPRO_SENTINEL/);
        return { status: 1, stdout: '', stderr: 'upload failed' };
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.temporary_payloads_cleaned, true);
    assert.equal(fs.existsSync(temporaryBodyFile), false);
    assert.equal(fs.existsSync(path.dirname(temporaryBodyFile)), false);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('runLogsIngestionUpload refuses Azure writes when the active subscription differs', () => {
  const calls = [];
  const result = runLogsIngestionUpload({
    ok: true,
    dir: '/tmp/not-used',
    errors: [],
    uploads: [{ table: 'AgentOpsEvents_CL', file: '/tmp/not-read', uri: 'https://example', rows: 1 }]
  }, {
    expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
    approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
    spawnSync(command, args) {
      calls.push([command, args]);
      return { status: 0, stdout: '11111111-1111-1111-1111-111111111111\n', stderr: '' };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.equal(result.uploads.length, 0);
  assert.match(result.errors[0], /refused the write/);
  assert.equal(calls.length, 1);
});

test('durable uploader targets the canonical DCR stream and refreshes an expired token', async () => {
  const requests = [];
  const tokens = ['expired-token', 'fresh-token'];
  const uploader = createDurableLogsIngestionUploader({
    endpoint: 'https://example.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-immutable-safe',
    expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
    approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
    spawnSync: approvedSubscriptionSpawn,
    tokenProvider: async () => tokens.shift(),
    fetchImpl: async (uri, request) => {
      requests.push({ uri, request });
      return { status: requests.length === 1 ? 401 : 204, headers: {} };
    }
  });

  const row = { RunId: 'run-safe', Sequence: 1, EventId: 'event-safe' };
  const response = await uploader(row, { table: 'AgentOpsEvents_CL' });
  assert.equal(response.status, 204);
  assert.equal(requests.length, 2);
  assert.match(requests[0].uri, /streams\/Custom-AgentOpsEvents_CL\?api-version=2023-01-01$/);
  assert.equal(requests[0].request.headers.Authorization, 'Bearer expired-token');
  assert.equal(requests[1].request.headers.Authorization, 'Bearer fresh-token');
  assert.deepEqual(JSON.parse(requests[1].request.body), [row]);
});

test('durable uploader fails closed on subscription mismatch and non-canonical tables', async () => {
  assert.throws(() => createDurableLogsIngestionUploader({
    endpoint: 'https://example.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-safe',
    expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
    approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
    spawnSync() {
      return { status: 0, stdout: '360d1dc4-b7ca-41c9-b3bf-399942056b69\n', stderr: '' };
    }
  }), /refused the write/);

  const uploader = createDurableLogsIngestionUploader({
    endpoint: 'https://example.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-safe',
    expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
    approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
    spawnSync: approvedSubscriptionSpawn,
    tokenProvider: async () => 'unused',
    fetchImpl: async () => { throw new Error('must not send'); }
  });
  assert.equal((await uploader({}, { table: 'AgentOpsUnknown_CL' })).status, 400);
});

test('durable uploader rejects token-exfiltration endpoints and malformed DCR IDs', () => {
  const common = {
    dcrImmutableId: 'dcr-safe',
    expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
    approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
    spawnSync: approvedSubscriptionSpawn
  };
  for (const endpoint of [
    'https://attacker.example',
    'https://example.ingest.monitor.azure.com.attacker.example',
    'https://user:password@example.ingest.monitor.azure.com',
    'https://example.ingest.monitor.azure.com/path',
    'https://example.ingest.monitor.azure.com?forward=true',
    'https://example.ingest.monitor.azure.com#fragment'
  ]) {
    assert.throws(() => createDurableLogsIngestionUploader({ ...common, endpoint }), /Azure public Monitor ingestion endpoint/);
  }
  assert.throws(() => createDurableLogsIngestionUploader({
    ...common,
    endpoint: 'https://example.ingest.monitor.azure.com',
    dcrImmutableId: '../unsafe'
  }), /valid DCR immutable ID/);
});

test('durable uploader applies a bounded timeout and cancels response bodies', async () => {
  let request;
  let cancelled = 0;
  const uploader = createDurableLogsIngestionUploader({
    endpoint: 'https://example.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-safe',
    timeoutMs: 1234,
    expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
    approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
    spawnSync: approvedSubscriptionSpawn,
    tokenProvider: async () => 'safe-token',
    fetchImpl: async (_uri, options) => {
      request = options;
      return { status: 204, headers: {}, body: { async cancel() { cancelled += 1; } } };
    }
  });
  const response = await uploader({}, { table: 'AgentOpsEvents_CL' });
  assert.equal(response.status, 204);
  assert.ok(request.signal);
  assert.equal(cancelled, 1);
  assert.throws(() => createDurableLogsIngestionUploader({
    endpoint: 'https://example.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-safe',
    timeoutMs: 120001,
    expectedSubscriptionId: '11111111-1111-4111-8111-111111111111',
    approvedSubscriptionIds: ['11111111-1111-4111-8111-111111111111'],
    spawnSync: approvedSubscriptionSpawn
  }), /timeoutMs/);
});
