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

test('span-only plan selects metadata spans without enabling rich content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-span-plan-'));
  try {
    fs.writeFileSync(path.join(directory, 'AgentOpsSpans_CL.jsonl'), `${JSON.stringify({
      TimeGenerated: '2026-01-01T00:00:00Z', RunId: 'run-1', SessionId: 'session-1', TraceId: 'trace-1',
      SpanId: 'span-1', ParentSpanId: '', SpanName: 'agentops.script', LinkType: 'run-id-logical-link', Outcome: 'ok', SchemaVersion: '2'
    })}\n`);
    const plan = buildAzureIngestPlan({ dir: directory, spansOnly: true });
    assert.equal(plan.ok, true);
    assert.deepEqual(Object.keys(plan.tables), ['AgentOpsSpans_CL']);
    const upload = buildLogsIngestionUploadPlan({
      dir: directory, spansOnly: true, endpoint: 'https://example.ingest.monitor.azure.com', dcrImmutableId: 'dcr-test'
    });
    assert.equal(upload.ok, true);
    assert.equal(upload.spans_only, true);
    assert.deepEqual(upload.uploads.map(item => item.stream), ['Custom-AgentOpsSpans_CL']);
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
    const unsafe = buildLogsIngestionUploadPlan({
      dir: directory, spansOnly: true, endpoint: 'http://example.com', dcrImmutableId: 'dcr-test'
    });
    assert.equal(unsafe.ok, false);
    assert.match(unsafe.errors.join(' '), /span-only upload requires an Azure public Monitor ingestion endpoint/);
    const invalidDcr = buildLogsIngestionUploadPlan({
      dir: directory, spansOnly: true, endpoint: 'https://example.ingest.monitor.azure.com', dcrImmutableId: 'invalid'
    });
    assert.match(invalidDcr.errors.join(' '), /span-only upload requires a valid DCR immutable ID/);

    const spanFile = path.join(directory, 'AgentOpsSpans_CL.jsonl');
    const spanRow = JSON.stringify({
      TimeGenerated: '2026-01-01T00:00:00Z', RunId: 'run-1', SessionId: 'session-1', TraceId: 'trace-1',
      SpanId: 'span-1', ParentSpanId: '', SpanName: 'agentops.script', LinkType: 'run-id-logical-link', Outcome: 'ok', SchemaVersion: '2'
    });
    fs.writeFileSync(spanFile, `${spanRow}${' '.repeat(1024 * 1024)}\n`);
    const oversized = buildLogsIngestionUploadPlan({
      dir: directory, spansOnly: true, endpoint: 'https://example.ingest.monitor.azure.com', dcrImmutableId: 'dcr-test'
    });
    assert.match(oversized.errors.join(' '), /span-only upload is limited to 1 MiB per reviewed batch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('events-only plan exports session metadata without requiring the run-summary table', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-events-plan-'));
  try {
    fs.writeFileSync(path.join(directory, 'AgentOpsEvents_CL.jsonl'), `${JSON.stringify({
      TimeGenerated: '2026-01-01T00:00:00Z', RunId: 'run-1', SessionId: 'session-1', EventName: 'tool.execution_start',
      ToolCallId: 'call-1', ReferenceName: '.agents/skills/example/references/guide.md', ContentCaptureMode: 'off', SchemaVersion: '2'
    })}\n`);
    const plan = buildAzureIngestPlan({ dir: directory, eventsOnly: true });
    assert.equal(plan.ok, true);
    assert.deepEqual(Object.keys(plan.tables), ['AgentOpsEvents_CL']);
    const upload = buildLogsIngestionUploadPlan({
      dir: directory, eventsOnly: true, endpoint: 'https://example.ingest.monitor.azure.com', dcrImmutableId: 'dcr-test'
    });
    assert.equal(upload.ok, true);
    assert.equal(upload.events_only, true);
    assert.deepEqual(upload.uploads.map(item => item.stream), ['Custom-AgentOpsEvents_CL']);
    assert.equal(buildAzureIngestPlan({ dir: directory, eventsOnly: true, spansOnly: true }).ok, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
