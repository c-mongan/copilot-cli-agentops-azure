const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { attentionText, outcomeSummaryText, sessionStatusSignals } = require('../src/lib/copilot/run-status');
const { summarizeSessionEvents } = require('../src/lib/digest/session-metadata');
const { buildDigest, parsePeriod } = require('../src/lib/digest/digest-summary');
const { loadPriceTable } = require('../src/lib/cost-estimate');
const { renderDigestMarkdown } = require('../src/lib/digest/render-markdown');
const { RunStore } = require('../src/lib/ui/data');
const { exportSessionGenAi, renderGenAiExport } = require('../src/lib/copilot/session-genai-export');
const { launchRunStatus } = require('../src/lib/copilot/session-command');
const { shortenHomePaths } = require('../src/lib/command-output');

// One session, every surface: 1 failed tool call, 1 denial, 1 shell non-zero
// exit and 1 clean call. Token usage matches the round-2 QA run, whose cost
// agreed exactly with Copilot's own accounting (totalNanoAiu 8748600000).
const SESSION_ID = '00000000-0000-4000-8000-0000000fa11e';
const RUN_ID = 'native_run_failsem_0000000001';
const MODEL = 'gpt-6.1-sol';
const TRACE = 'd8390c6b75a875b41b7743fbbe0aeb2b';
const START = Date.parse('2026-10-07T10:00:00.000Z');
const NOW = START + 60 * 60 * 1000;
const USAGE = { inputTokens: 174040, outputTokens: 522, cacheReadTokens: 146920, cacheWriteTokens: 26668 };

const iso = offsetMs => new Date(START + offsetMs).toISOString();

function sessionEvents() {
  const tools = [
    { id: 'call-ok', name: 'view', complete: { success: true } },
    { id: 'call-denied', name: 'view', complete: { success: false, error: { code: 'denied', message: 'Permission denied' } } },
    { id: 'call-failed', name: 'web_fetch', complete: { success: false, error: { code: 'failure', message: 'boom' } } },
    { id: 'call-exit', name: 'bash', complete: { success: true, shellExecution: { exitCode: 1 } } }
  ];
  const events = [
    { type: 'session.start', timestamp: iso(0), data: { sessionId: SESSION_ID, startTime: iso(0), selectedModel: MODEL, context: { cwd: '/work/repo', gitRoot: '/work/repo' } } },
    { type: 'user.message', timestamp: iso(500), data: { content: 'SECRET-PROMPT' } }
  ];
  tools.forEach((tool, index) => {
    const at = 1000 + index * 2000;
    events.push({ type: 'tool.execution_start', timestamp: iso(at), data: { toolCallId: tool.id, toolName: tool.name, model: MODEL } });
    events.push({ type: 'tool.execution_complete', timestamp: iso(at + 1000), data: { toolCallId: tool.id, model: MODEL, ...tool.complete } });
  });
  events.push({ type: 'session.shutdown', timestamp: iso(20000), data: { totalPremiumRequests: 1, modelMetrics: { [MODEL]: { usage: USAGE } } } });
  return events;
}

function spanRow(fields) {
  return {
    TimeGenerated: iso(20000), RunId: RUN_ID, SessionId: SESSION_ID, TraceId: TRACE, ParentToolCallId: '', AgentName: '',
    ToolName: '', ToolCallId: '', ToolCallEvidence: '', McpServerName: '', McpToolName: '', Model: '', ModelRequested: '',
    ModelActual: '', Provider: 'github', InputTokens: null, OutputTokens: null, CacheReadTokens: null, CacheWriteTokens: null,
    ErrorType: '', DurationMs: 1000, DurationNs: 1000000000, Outcome: 'ok', LinkType: 'native-session', SchemaVersion: '2',
    SpanName: 'agentops.span', StepName: '', EventName: '', SkillName: '', ...fields
  };
}

function spanRows() {
  const tool = (spanId, toolCallId, at, extra = {}) => spanRow({ SpanId: spanId, ParentSpanId: '79c82c2340d5cdb6', TimeGenerated: iso(at), ToolName: toolCallId === 'call-failed' ? 'web_fetch' : toolCallId === 'call-exit' ? 'bash' : 'view', ToolCallId: toolCallId, ToolCallEvidence: 'exact-session-tool-call-id', OperationName: 'execute_tool', ...extra });
  return [
    spanRow({ SpanId: '79c82c2340d5cdb6', ParentSpanId: '', TimeGenerated: iso(0), DurationMs: 20000, DurationNs: 20000000000, OperationName: 'invoke_agent', InputTokens: USAGE.inputTokens, OutputTokens: USAGE.outputTokens }),
    tool('cc8f3e9e95836b14', 'call-ok', 1000),
    tool('5fe45fc1ab007422', 'call-denied', 3000, { Outcome: 'failed', ErrorType: 'denied' }),
    // A permission span whose native name was not preserved: not a GenAI operation.
    spanRow({ SpanId: '0fc76571f496443a', ParentSpanId: '5fe45fc1ab007422', TimeGenerated: iso(3001), DurationMs: 2, DurationNs: 2000000, OperationName: 'agentops.span' }),
    tool('9a0b7fb53ae7ad5c', 'call-failed', 5000, { Outcome: 'failed', ErrorType: 'failure' }),
    tool('4d5a9ce3c7825426', 'call-exit', 7000)
  ];
}

function writeFixture(root) {
  const copilotHome = path.join(root, 'copilot');
  const agentOpsHome = path.join(root, 'agentops');
  const sessionDir = path.join(copilotHome, 'session-state', SESSION_ID);
  const runDir = path.join(agentOpsHome, 'runs', RUN_ID);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  const eventsFile = path.join(sessionDir, 'events.jsonl');
  fs.writeFileSync(eventsFile, `${sessionEvents().map(event => JSON.stringify(event)).join('\n')}\n`);
  fs.writeFileSync(path.join(runDir, 'AgentOpsSpans_CL.jsonl'), `${spanRows().map(row => JSON.stringify(row)).join('\n')}\n`);
  fs.writeFileSync(path.join(runDir, 'run-context.json'), JSON.stringify({ runId: RUN_ID, sessionId: SESSION_ID, createdAt: iso(0) }));
  return { copilotHome, agentOpsHome, eventsFile, runDir };
}

function withFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-failsem-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return writeFixture(root);
}

const EXPECTED = { failed: 1, denied: 1, nonZeroExit: 1 };

test('shared outcome text says failed tool calls and needs attention', () => {
  assert.equal(attentionText({ denials: 1, nonZeroExits: 1 }), '1 denied, 1 non-zero exit');
  assert.equal(attentionText({ denials: 0, nonZeroExits: 2 }), '0 denied, 2 non-zero exits');
  assert.equal(outcomeSummaryText({ toolFailures: 0, denials: 1, nonZeroExits: 1 }), 'Failed tool calls 0 · Needs attention: 1 denied, 1 non-zero exit');
  assert.equal(outcomeSummaryText({ toolFailures: 1, hookFailures: 1, denials: 0, nonZeroExits: 0 }), 'Failed tool calls 1 · failed hooks 1 · Needs attention: 0 denied, 0 non-zero exits');
});

test('a replayed tool completion counts once, as in the digest', () => {
  const events = sessionEvents();
  const replay = events.find(event => event.data?.toolCallId === 'call-failed' && event.type === 'tool.execution_complete');
  const signals = sessionStatusSignals([...events, replay]);
  assert.equal(signals.toolCalls, 4);
  assert.equal(signals.toolFailures, 1);
  assert.equal(summarizeSessionEvents([...events, replay]).failedToolCalls, 1);
});

test('one session reports the same failure and attention counts in digest, UI, export-otel and launch', async t => {
  const fixture = withFixture(t);
  const events = sessionEvents();

  // Digest
  const session = summarizeSessionEvents(events);
  const digest = buildDigest({ sessions: [{ ...session, sessionId: SESSION_ID, runId: SESSION_ID }], nowMs: NOW, period: parsePeriod('24h'), prices: loadPriceTable() });
  const digestCounts = { failed: digest.current.failedToolCalls, denied: digest.current.deniedToolCalls, nonZeroExit: digest.current.nonZeroExitToolCalls };
  assert.deepEqual(digestCounts, EXPECTED);
  assert.equal(digest.current.toolCalls, 4);
  assert.equal(digest.current.sessionsWithFailures, 1);
  assert.equal(digest.failureClusters.failed, 1);
  assert.equal(digest.failureClusters.attention, 2);
  const markdown = renderDigestMarkdown(digest);
  assert.match(markdown, /\| Failed tool calls \| 1 of 4 /);
  assert.match(markdown, /\| Needs attention \| 1 denied, 1 non-zero exit \|/);

  // UI API (/api/runs and /api/runs/<id>)
  const store = new RunStore({ copilotHome: fixture.copilotHome, agentOpsHome: fixture.agentOpsHome, now: () => NOW });
  const list = await store.list();
  const detail = await store.detail(SESSION_ID);
  const uiCounts = { failed: detail.run.toolFailures, denied: detail.run.denials, nonZeroExit: detail.run.nonZeroExits };
  assert.deepEqual(uiCounts, EXPECTED);
  assert.deepEqual({ failed: list.kpis.toolFailures, denied: list.kpis.denials, nonZeroExit: list.kpis.nonZeroExits }, EXPECTED);
  assert.equal(detail.run.status, 'failed');

  // export-otel summary (OTel status stays ERROR on all three issue spans)
  const exported = await exportSessionGenAi({ sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: fixture.agentOpsHome, eventsFile: fixture.eventsFile, dryRun: true });
  const exportCounts = { failed: exported.failed_tools, denied: exported.denied_tools, nonZeroExit: exported.nonzero_exit_tools };
  assert.deepEqual(exportCounts, EXPECTED);
  assert.equal(exported.status_counts_source, 'session-events');
  assert.equal(exported.otel_error_spans, 3);
  const rendered = renderGenAiExport(exported);
  assert.match(rendered, /Failed tool calls 1 · Needs attention: 1 denied, 1 non-zero exit · 3 spans have OTel status ERROR/);

  // launch --json status (same session events)
  const launch = launchRunStatus({ copilotHome: fixture.copilotHome, sessionId: SESSION_ID, runErrored: false });
  const launchCounts = { failed: launch.signals.toolFailures, denied: launch.signals.denials, nonZeroExit: launch.signals.nonZeroExits };
  assert.deepEqual(launchCounts, EXPECTED);
  assert.equal(launch.status, detail.run.status);
});

test('export-otel reports each native span it did not export, with a reason', async t => {
  const fixture = withFixture(t);
  const exported = await exportSessionGenAi({ sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: fixture.agentOpsHome, eventsFile: fixture.eventsFile, dryRun: true });
  assert.equal(exported.native_spans_read, 6);
  assert.equal(exported.spans, 5);
  assert.equal(exported.duplicates_dropped, 0);
  assert.equal(exported.non_genai_skipped, 1);
  assert.deepEqual(exported.skipped, [{ operation: 'agentops.span', count: 1, reason: 'not a GenAI operation (invoke_agent, chat or execute_tool)' }]);
  assert.match(renderGenAiExport(exported), /Read 6 native spans → exported 5 .* · 1 skipped \(agentops\.span\): not a GenAI operation/);
});

test('export-otel sets gen_ai.usage.cache_creation.input_tokens from the session cache-write total', async t => {
  const fixture = withFixture(t);
  const output = path.join(fixture.runDir, 'otlp.json');
  const exported = await exportSessionGenAi({ sessionId: SESSION_ID, runId: RUN_ID, agentopsHome: fixture.agentOpsHome, eventsFile: fixture.eventsFile, output, dryRun: true });
  assert.equal(exported.tokens.invoke_agent_cache_creation, USAGE.cacheWriteTokens);
  assert.equal(exported.tokens.invoke_agent_cache_read, USAGE.cacheReadTokens);
  const request = JSON.parse(fs.readFileSync(output, 'utf8'));
  const spans = request.resourceSpans.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans));
  const root = spans.find(span => span.attributes.some(attribute => attribute.key === 'gen_ai.operation.name' && attribute.value.stringValue === 'invoke_agent'));
  const attribute = key => root.attributes.find(entry => entry.key === key)?.value;
  assert.deepEqual(attribute('gen_ai.usage.cache_creation.input_tokens'), { intValue: String(USAGE.cacheWriteTokens) });
  assert.deepEqual(attribute('gen_ai.usage.cache_read.input_tokens'), { intValue: String(USAGE.cacheReadTokens) });
  assert.match(renderGenAiExport(exported), /invoke_agent 174040 in \/ 522 out \(cache read 146920, cache write 26668\)/);
  assert.equal(fs.readFileSync(output, 'utf8').includes('SECRET-PROMPT'), false);
});

test('UI and digest price the QA usage at exactly $0.087486 with cache read and write kept apart', async t => {
  const fixture = withFixture(t);
  const store = new RunStore({ copilotHome: fixture.copilotHome, agentOpsHome: fixture.agentOpsHome, now: () => NOW });
  const detail = await store.detail(SESSION_ID);
  assert.equal(Math.round(detail.run.costUsd * 1e6) / 1e6, 0.087486);
  const usage = detail.usageByModel.find(row => row.model === MODEL);
  assert.equal(usage.cacheRead, USAGE.cacheReadTokens);
  assert.equal(usage.cacheWrite, USAGE.cacheWriteTokens);
  const digest = buildDigest({ sessions: [{ ...summarizeSessionEvents(sessionEvents()), sessionId: SESSION_ID, runId: SESSION_ID }], nowMs: NOW, period: parsePeriod('24h'), prices: loadPriceTable() });
  assert.equal(Math.round(digest.current.tokens.estCostUsd * 1e6) / 1e6, 0.087486);
});

test('JSON output replaces the home directory with ~ and leaves other values alone', () => {
  const home = path.join(path.sep, 'Users', 'someone');
  const value = {
    outputDir: path.join(home, '.agentops', 'runs', 'r1'),
    files: [path.join(home, '.copilot', 'otel', 'a.jsonl'), '/var/data/x'],
    exact: home,
    sibling: `${home}2/not-home`,
    count: 3,
    nested: { ok: true, none: null }
  };
  const shortened = shortenHomePaths(value, home);
  assert.equal(shortened.outputDir, path.join('~', '.agentops', 'runs', 'r1'));
  assert.deepEqual(shortened.files, [path.join('~', '.copilot', 'otel', 'a.jsonl'), '/var/data/x']);
  assert.equal(shortened.exact, '~');
  assert.equal(shortened.sibling, `${home}2/not-home`);
  assert.equal(shortened.count, 3);
  assert.deepEqual(shortened.nested, { ok: true, none: null });
  assert.equal(value.outputDir, path.join(home, '.agentops', 'runs', 'r1'), 'input is not mutated');
  assert.equal(shortenHomePaths({ a: '/x' }, '/').a, '/x', 'a root home is never collapsed');
});
