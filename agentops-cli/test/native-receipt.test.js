const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  deriveReceipt,
  nativeOpenResult,
  readNativeReceiptFile,
  readNativeReceiptFromArgs,
  renderNativeReceipt
} = require('../src/lib/native-receipt');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-native-receipt-'));
}

function attr(key, value) {
  const encoded = typeof value === 'boolean'
    ? { boolValue: value }
    : typeof value === 'number'
      ? { intValue: value }
      : { stringValue: value };
  return { key, value: encoded };
}

function nano(iso) {
  return String(BigInt(new Date(iso).getTime()) * 1000000n);
}

function nativeRequest({ session = 'session-native', outcome, includePoison = false, ended = true, agentStop = false } = {}) {
  const attributes = [
    attr('agentops.session.id', session),
    attr('agentops.run.id', 'run-native'),
    attr('gen_ai.operation.name', 'invoke_agent'),
    attr('gen_ai.request.model', 'gpt-native'),
    attr('gen_ai.tool.name', 'shell'),
    attr('gen_ai.usage.input_tokens', 12),
    attr('gen_ai.usage.output_tokens', 5),
    attr('github.copilot.cost', 2),
    ...(outcome ? [attr('agentops.outcome', outcome)] : []),
    ...(includePoison ? [
      attr('gen_ai.input.messages', 'SECRET_PROMPT_DO_NOT_RETURN'),
      attr('gen_ai.output.messages', 'SECRET_RESPONSE_DO_NOT_RETURN'),
      attr('gen_ai.tool.call.arguments', 'SECRET_TOOL_ARGS_DO_NOT_RETURN'),
      attr('gen_ai.tool.call.result', 'SECRET_TOOL_RESULT_DO_NOT_RETURN'),
      attr('code.filepath', '/private/SECRET_SOURCE.js'),
      attr('url.full', 'https://secret.example.invalid/token=SECRET'),
      attr('authorization', 'Bearer SECRET_TOKEN_DO_NOT_RETURN')
    ] : [])
  ];
  const span = {
    traceId: 'trace-native',
    spanId: 'span-native',
    name: 'copilot.invoke_agent',
    startTimeUnixNano: nano('2026-08-14T10:00:00.000Z'),
    attributes,
    status: { code: 'STATUS_CODE_OK' }
  };
  if (ended) span.endTimeUnixNano = nano('2026-08-14T10:00:02.000Z');
  if (agentStop) {
    span.events = [{
      name: 'github.copilot.hook.end',
      attributes: [attr('github.copilot.hook.type', 'agentStop')]
    }];
  }
  return {
    resourceSpans: [{
      resource: { attributes: [attr('service.name', 'github-copilot-cli'), attr('agent.runtime', 'github-copilot')] },
      scopeSpans: [{ spans: [span] }]
    }]
  };
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
  return filePath;
}

test('native reader derives an explicit task-complete metadata-only receipt from sanitized OTLP file records', () => {
  const result = readNativeReceiptFile(writeJsonl(path.join(tempDir(), 'receipt.jsonl'), [
    nativeRequest({ outcome: 'completed', includePoison: true })
  ]));

  assert.equal(result.recognized, true);
  assert.equal(result.status, 'TASK_COMPLETED');
  assert.equal(result.reason, null);
  assert.equal(result.receipt.session_id, 'session-native');
  assert.equal(result.receipt.run_id, 'run-native');
  assert.equal(result.receipt.duration_ms, 2000);
  assert.deepEqual(result.receipt.tools, ['shell']);
  assert.equal(result.receipt.tool_calls, 1);
  assert.equal(result.receipt.input_tokens, 12);
  assert.equal(result.receipt.output_tokens, 5);
  assert.equal(result.receipt.credits, 2);
  assert.equal(result.receipt.content_signal, true);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_PROMPT|SECRET_RESPONSE|SECRET_TOOL|SECRET_SOURCE|SECRET_TOKEN|authorization/i);
});

test('native reader distinguishes observed telemetry from missing completion semantics', () => {
  const result = deriveReceipt([
    {
      sessionId: 'session-partial',
      traceId: 'trace-partial',
      start: '2026-08-14T10:00:00.000Z',
      end: '2026-08-14T10:00:01.000Z',
      operation: 'invoke_agent',
      tool: 'shell',
      model: 'gpt-native',
      inputTokens: 1,
      outputTokens: 2,
      credits: 0,
      contentSignal: false,
      contentDroppedBytes: 0,
      failed: false,
      terminal: null,
      safePrivacyMode: 'strict',
      safeContentMode: 'off'
    }
  ]);

  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.reason, 'NO_SAFE_COMPLETION_SIGNAL');
  assert.equal(result.observed, true);
  assert.ok(result.data_missing.includes('safe native OTLP processing/task completion signal'));
  const rendered = renderNativeReceipt({ status: result.status, receipt: result });
  assert.doesNotMatch(rendered, /^(?:Result|Status): Completed$/m);
  assert.match(rendered, /Observed: OBSERVED/);
  assert.match(rendered, /No task-success claim was made/);
});

test('native reader classifies the Copilot agentStop hook as a processing-stop signal', () => {
  const result = readNativeReceiptFile(writeJsonl(path.join(tempDir(), 'agent-stop.jsonl'), [
    nativeRequest({ agentStop: true })
  ]));

  assert.equal(result.status, 'PROCESSING_STOPPED');
  assert.equal(result.receipt.session_id, 'session-native');
});

test('native reader selects the latest session without exposing raw OTLP payloads', () => {
  const latest = deriveReceipt([
    {
      sessionId: 'old-session', traceId: 'old-trace', start: '2026-08-14T09:00:00.000Z', end: '2026-08-14T09:00:01.000Z',
      operation: 'invoke_agent', tool: 'old-tool', model: 'old-model', inputTokens: 1, outputTokens: 1, credits: 0,
      contentSignal: false, contentDroppedBytes: 0, failed: false, terminal: 'TASK_COMPLETED', safePrivacyMode: 'strict', safeContentMode: 'off'
    },
    {
      sessionId: 'new-session', traceId: 'new-trace', start: '2026-08-14T10:00:00.000Z', end: '2026-08-14T10:00:03.000Z',
      operation: 'invoke_agent', tool: 'new-tool', model: 'new-model', inputTokens: 3, outputTokens: 4, credits: 1,
      contentSignal: false, contentDroppedBytes: 0, failed: false, terminal: 'TASK_COMPLETED', safePrivacyMode: 'strict', safeContentMode: 'off'
    }
  ]);

  assert.equal(latest.session_id, 'new-session');
  assert.deepEqual(latest.tools, ['new-tool']);
  assert.equal(latest.status, 'TASK_COMPLETED');
});

test('native reader handles metric and log file-export records without returning log bodies', () => {
  const result = readNativeReceiptFile(writeJsonl(path.join(tempDir(), 'mixed.jsonl'), [{
    resourceMetrics: [{
      resource: { attributes: [attr('service.name', 'github-copilot-cli')] },
      scopeMetrics: [{ metrics: [{
        name: 'gen_ai.input_tokens',
        sum: { dataPoints: [{
          attributes: [attr('agentops.session.id', 'mixed-session')],
          asInt: '7',
          timeUnixNano: nano('2026-08-14T10:00:00.000Z')
        }] }
      }] }]
    }]
  }, {
    resourceLogs: [{
      scopeLogs: [{ logRecords: [{
        body: { stringValue: 'SECRET_LOG_BODY_DO_NOT_RETURN' },
        attributes: [
          attr('agentops.session.id', 'mixed-session'),
          attr('agentops.outcome', 'completed'),
          attr('gen_ai.prompt', 'SECRET_LOG_PROMPT_DO_NOT_RETURN')
        ],
        timeUnixNano: nano('2026-08-14T10:00:01.000Z')
      }] }]
    }]
  }]));

  assert.equal(result.status, 'TASK_COMPLETED');
  assert.equal(result.receipt.session_id, 'mixed-session');
  assert.equal(result.receipt.input_tokens, 7);
  assert.equal(result.receipt.content_signal, true);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_LOG_BODY|SECRET_LOG_PROMPT/);
});

test('explicit legacy wrapper/demo JSONL remains available as fallback', () => {
  const file = writeJsonl(path.join(tempDir(), 'wrapper-events.jsonl'), [{
    type: 'span',
    session: 'wrapper-session',
    operation: 'chat',
    attributes: { 'gen_ai.operation.name': 'chat' }
  }]);
  const result = readNativeReceiptFromArgs(['open', 'latest', '--file', file], {});

  assert.equal(result.selected_by, 'cli');
  assert.equal(result.recognized, false);
});

test('env-selected native file fails closed when it is absent', () => {
  const result = readNativeReceiptFromArgs([], {
    AGENTOPS_OTEL_RECEIPT_PATH: path.join(tempDir(), 'missing.jsonl')
  });

  assert.equal(result.selected_by, 'env');
  assert.equal(result.recognized, true);
  assert.equal(result.status, 'UNOBSERVED');
  assert.equal(result.reason, 'FILE_UNREADABLE');
  assert.equal(result.receipt.observed, false);
});

test('open latest selects the default local receipt when it exists', () => {
  const collectorHome = path.join(tempDir(), 'collector');
  fs.mkdirSync(collectorHome, { recursive: true });
  writeJsonl(path.join(collectorHome, 'native-receipt.jsonl'), [nativeRequest({ outcome: 'completed' })]);
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'src', 'index.js'),
    'open', 'latest', '--json'
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENTOPS_COLLECTOR_HOME: collectorHome,
      AGENTOPS_OTEL_RECEIPT_PATH: ''
    }
  });

  assert.equal(cli.status, 0, cli.stderr);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.source, 'native-local-file');
  assert.equal(result.status, 'TASK_COMPLETED');
});

test('open command uses native receipt output for an OTLP file and keeps JSON metadata-only', () => {
  const file = writeJsonl(path.join(tempDir(), 'native.jsonl'), [nativeRequest({ outcome: 'completed', includePoison: true })]);
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'src', 'index.js'),
    'open', 'latest', '--file', file, '--json'
  ], { encoding: 'utf8', env: { ...process.env, AGENTOPS_OTEL_RECEIPT_PATH: '' } });

  assert.equal(cli.status, 0, cli.stderr);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.source, 'native-local-file');
  assert.equal(result.status, 'TASK_COMPLETED');
  assert.equal(result.receipt.content_signal, true);
  assert.doesNotMatch(cli.stdout, /SECRET_PROMPT|SECRET_RESPONSE|SECRET_TOOL|SECRET_SOURCE|SECRET_TOKEN/);
});

test('open command reads the env-selected native receipt when no file flag is supplied', () => {
  const file = writeJsonl(path.join(tempDir(), 'env-native.jsonl'), [nativeRequest({ outcome: 'completed' })]);
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'src', 'index.js'),
    'open', 'latest', '--json'
  ], { encoding: 'utf8', env: { ...process.env, AGENTOPS_OTEL_RECEIPT_PATH: file } });

  assert.equal(cli.status, 0, cli.stderr);
  const result = JSON.parse(cli.stdout);
  assert.equal(result.source, 'native-local-file');
  assert.equal(result.status, 'TASK_COMPLETED');
});

test('open command preserves legacy file behavior when the file is not OTLP', () => {
  const file = writeJsonl(path.join(tempDir(), 'legacy.jsonl'), [{
    TimeGenerated: '2026-08-14T10:00:00.000Z',
    SessionId: 'legacy-session',
    SpanName: 'legacy span'
  }]);
  const cli = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'src', 'index.js'),
    'open', 'latest', '--file', file
  ], { encoding: 'utf8', env: { ...process.env, AGENTOPS_OTEL_RECEIPT_PATH: '' } });

  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /AgentOps investigation links/);
  assert.doesNotMatch(cli.stdout, /AgentOps native local receipt/);
});

test('native open result keeps links separate from the local receipt state', () => {
  const native = readNativeReceiptFile(writeJsonl(path.join(tempDir(), 'native.jsonl'), [nativeRequest({ outcome: 'completed' })]));
  const result = nativeOpenResult(native, {
    primary_investigation_url: 'https://appinsights.test',
    primary_investigation_label: 'Application Insights (open Agents)',
    cloud_verified: true
  });

  assert.equal(result.status, 'TASK_COMPLETED');
  assert.equal(result.links.primary, 'https://appinsights.test');
  assert.equal(result.links.primary_label, 'Application Insights (open Agents)');
  assert.equal(result.links.cloud_verified, true);
  assert.doesNotMatch(JSON.stringify(result), /prompt|completion|tool.call.arguments|secret/i);
});

test('native open keeps configured cloud links separate from query-verified evidence', () => {
  const native = readNativeReceiptFile(writeJsonl(path.join(tempDir(), 'native-unverified.jsonl'), [nativeRequest({ outcome: 'completed' })]));
  const result = nativeOpenResult(native, {
    primary_investigation_url: 'https://appinsights.test',
    primary_investigation_label: 'Application Insights (open Agents)'
  });

  assert.equal(result.links.primary, null);
  assert.equal(result.links.configured_primary, 'https://appinsights.test');
  assert.equal(result.links.cloud_verified, false);
  assert.equal(result.links.cloud_evidence, 'not-query-verified');
});
