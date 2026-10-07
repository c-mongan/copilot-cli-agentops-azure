const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const data = require('../src/lib/ui/data');
const {
  FAILED_ID,
  LEDGER_ONLY_ID,
  LEDGER_ONLY_RUN_ID,
  OPEN_ID,
  RUN_ID,
  SECRETS,
  T0,
  createUiFixture
} = require('./support/ui-fixture');

function storeFor(fixture, options = {}) {
  return new data.RunStore({ copilotHome: fixture.copilotHome, agentOpsHome: fixture.agentOpsHome, now: fixture.now, ...options });
}

function assertNoSecrets(value, label) {
  const json = JSON.stringify(value);
  for (const secret of SECRETS) assert.equal(json.includes(secret), false, `${label} leaked ${secret}`);
  assert.equal(json.includes('/Users/someone'), false, `${label} leaked a local path`);
}

test('ui data: list and detail responses never contain prompt, argument, result or path text', async t => {
  const fixture = createUiFixture('privacy');
  t.after(fixture.cleanup);
  const store = storeFor(fixture);

  const list = await store.list();
  assertNoSecrets(list, 'list');
  for (const id of [FAILED_ID, OPEN_ID, LEDGER_ONLY_ID]) assertNoSecrets(await store.detail(id), `detail ${id}`);
  for (const row of list.runs) {
    assert.equal(Object.hasOwn(row, '_toolDurations'), false);
    assert.equal(Object.hasOwn(row, 'usageByModel'), false);
  }
  assert.equal(await store.content(FAILED_ID), null, 'content is disabled by default');
});

test('ui data: minimalEvent keeps only allowlisted metadata', () => {
  assert.equal(data.minimalEvent({ type: 'assistant.message', data: { content: 'x' } }), null);
  assert.equal(data.minimalEvent(null), null);
  const user = data.minimalEvent({ type: 'user.message', timestamp: '2026-10-07T10:00:00Z', data: { content: 'PROMPT_CANARY_7f3a' } });
  assert.deepEqual(Object.keys(user).sort(), ['agentId', 'time', 'type']);
  const start = data.minimalEvent({ type: 'tool.execution_start', data: { toolCallId: 'c1', toolName: 'curl ARG_CANARY_91bc', arguments: { url: 'ARG_CANARY_91bc' } } });
  assert.equal(start.toolName, 'unknown-tool');
  assert.equal(JSON.stringify(start).includes('ARG_SECRET'), false);
  const denied = data.minimalEvent({ type: 'tool.execution_complete', data: { toolCallId: 'c1', success: false, error: { code: 'denied', message: 'ERROR_CANARY_c4d1' } } });
  assert.equal(denied.outcome, 'denied');
  assert.equal(denied.success, false);
  const shellFailure = data.minimalEvent({ type: 'tool.execution_complete', data: { success: false, toolTelemetry: { properties: { shell_error_category: 'timeout' } } } });
  assert.equal(shellFailure.outcome, 'timeout');
  const generic = data.minimalEvent({ type: 'tool.execution_complete', data: { success: false, error: { code: 'has spaces' } } });
  assert.equal(generic.outcome, 'failed');
  const startEvent = data.minimalEvent({ type: 'session.start', data: { selectedModel: 'claude-haiku-4.5', startTime: '2026-10-07T10:00:00Z', context: { cwd: '/Users/someone/secret-parent-dir/demo-repo/' } } });
  assert.equal(startEvent.repo.name, 'demo-repo');
  assert.match(startEvent.repo.hash, /^[a-f0-9]{12}$/);
  assert.equal(startEvent.time, Date.parse('2026-10-07T10:00:00Z'));
  for (const type of ['session.resume', 'session.model_change', 'hook.end', 'subagent.failed', 'session.compaction_start']) {
    assert.equal(data.minimalEvent({ type, data: { newModel: 'gpt-6.1-sol', selectedModel: 'gpt-6.1-sol', hookType: 'preToolUse', agentName: 'explore' } }).type, type);
  }
});

test('ui data: safeLabel and repoIdentity reject unsafe values', () => {
  assert.equal(data.safeLabel('github-mcp-server/search_code'), 'github-mcp-server/search_code');
  assert.equal(data.safeLabel('has space'), '');
  assert.equal(data.safeLabel('"quoted"'), '');
  assert.equal(data.safeLabel('x'.repeat(81)), '');
  assert.equal(data.safeLabel(42), '');
  assert.deepEqual(data.repoIdentity(''), { name: '', hash: '' });
  assert.equal(data.repoIdentity('C:\\work\\repo\\').name, 'repo');
});

test('ui data: summarize uses the last shutdown, active time and failure outcomes', async t => {
  const fixture = createUiFixture('summary');
  t.after(fixture.cleanup);
  const list = await storeFor(fixture).list();
  assert.deepEqual(list.runs.map(run => run.id), [FAILED_ID, OPEN_ID, LEDGER_ONLY_ID]);
  const failed = list.runs[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.source, 'copilot+ledger');
  assert.equal(failed.runId, RUN_ID);
  assert.equal(failed.model, 'claude-haiku-4.5');
  assert.equal(failed.durationMs, 44000);
  assert.equal(failed.turns, 2);
  assert.equal(failed.toolCalls, 3);
  assert.equal(failed.toolFailures, 1);
  assert.deepEqual(failed.tokens, { input: 60000, output: 500, cacheRead: 50000, cacheWrite: 8000, known: true });
  assert.equal(failed.premiumRequests, 0.33);
  assert.equal(failed.costUsd, 0.0195);
  assert.deepEqual(failed.repo.name, 'demo-repo');
  assert.deepEqual(failed.failureGroups, [{ kind: 'tool', name: 'bash', outcome: 'denied', count: 1 }]);

  const open = list.runs[1];
  assert.equal(open.status, 'incomplete');
  assert.equal(open.tokens.known, false);
  assert.equal(open.costUsd, null);

  const ledgerOnly = list.runs[2];
  assert.equal(ledgerOnly.source, 'ledger');
  assert.equal(ledgerOnly.status, 'failed');
  assert.equal(ledgerOnly.durationMs, 5000);
  assert.deepEqual(ledgerOnly.failureGroups, [{ kind: 'tool', name: 'grep', outcome: 'timeout', count: 1 }]);
});

test('ui data: a recently written session without shutdown is live, even after a failure', () => {
  const entry = { id: 'live', eventsFile: 'x', mtimeMs: 1000, ledgerRuns: [] };
  const events = [
    { type: 'session.start', time: 0, model: 'gpt-6.1-sol' },
    { type: 'tool.execution_start', time: 10, toolCallId: 'a', toolName: 'bash', turnId: '' },
    { type: 'tool.execution_complete', time: 20, toolCallId: 'a', success: false, outcome: 'denied' }
  ];
  const row = data.summarize(entry, { events, firstTime: 0, lastTime: 20 }, [], 2000);
  assert.equal(row.status, 'live');
  assert.equal(row.failures, 1);
  assert.equal(data.summarize(entry, { events, firstTime: 0, lastTime: 20 }, [], 10 * 60 * 1000).status, 'failed');
});

test('ui data: resumed sessions sum active segments and use cumulative last shutdown usage', () => {
  const usage = tokens => ({ 'gpt-6.1-sol': { input: tokens, output: 1, cacheRead: 0, cacheWrite: 0 } });
  const events = [
    { type: 'session.start', time: 0 },
    { type: 'session.shutdown', time: 1000, usage: usage(100), premiumRequests: 1 },
    { type: 'session.resume', time: 86400000 },
    { type: 'session.shutdown', time: 86402000, usage: usage(250), premiumRequests: 2 }
  ];
  const row = data.summarize({ id: 'r', eventsFile: 'x', mtimeMs: 0, ledgerRuns: [] }, { events, firstTime: 0, lastTime: 86402000 }, [], 86402000 * 2);
  assert.equal(row.durationMs, 3000);
  assert.equal(row.tokens.input, 250);
  assert.equal(row.premiumRequests, 2);
  assert.equal(row.status, 'ok');
});

test('ui data: dedupeSpans keeps the first agentops.span row per TraceId and SpanId', () => {
  const rows = [
    { TraceId: 't', SpanId: 'a', SpanName: 'agentops.span', n: 1 },
    { TraceId: 't', SpanId: 'a', SpanName: 'agentops.span', n: 2 },
    { TraceId: 't', SpanId: 'a', SpanName: 'agentops.event', n: 3 },
    { TraceId: 'u', SpanId: 'a', n: 4 },
    { n: 5 },
    null
  ];
  assert.deepEqual(data.dedupeSpans(rows).map(row => row.n), [1, 4, 5]);
  assert.deepEqual(data.dedupeSpans(), []);
});

test('ui data: detail builds a deduplicated session -> turn -> tool/chat tree', async t => {
  const fixture = createUiFixture('detail');
  t.after(fixture.cleanup);
  const detail = await storeFor(fixture).detail(FAILED_ID);
  const shape = detail.spans.map(span => `${'  '.repeat(span.depth)}${span.kind}:${span.name}:${span.status}`);
  assert.deepEqual(shape, [
    'session:session:ok',
    '  hook:userPromptTransformed:ok',
    '  turn:turn 1:ok',
    '    chat:claude-haiku-4.5:ok',
    '    tool:bash:ok',
    '    tool:bash:failed',
    '    tool:unknown-tool:ok',
    '  turn:turn 2:ok',
    '    chat:claude-haiku-4.5:ok'
  ]);
  const ids = detail.spans.map(span => span.id);
  assert.equal(new Set(ids).size, ids.length);
  const okTool = detail.spans.find(span => span.attrs.toolCallId === 'toolu_ok');
  assert.equal(okTool.durationMs, 12000);
  assert.equal(okTool.attrs.spanId, 'tool0001', 'ledger tool spans join by toolCallId instead of duplicating');
  assert.equal(detail.spans.filter(span => span.kind === 'chat').length, 2, 'duplicate chat SpanId rows are dropped');
  assert.deepEqual(detail.failures, [{ kind: 'tool', name: 'bash', outcome: 'denied', count: 1, message: '1 tool call denied: bash' }]);
  assert.equal(detail.warnings.length, 1);
  assert.match(detail.warnings[0], /exited non-zero/);
  assert.equal(detail.allowContent, false);
});

test('ui data: tool stats report count, p50, p95, max and failures', () => {
  const spans = [
    { kind: 'tool', name: 'bash', durationMs: 57, status: 'failed' },
    { kind: 'tool', name: 'bash', durationMs: 12000, status: 'ok' },
    { kind: 'tool', name: 'view', durationMs: 5, status: 'ok' },
    { kind: 'turn', name: 'turn 1', durationMs: 99999, status: 'ok' }
  ];
  assert.deepEqual(data.toolStats(spans), [
    { tool: 'bash', count: 2, p50Ms: 57, p95Ms: 12000, maxMs: 12000, totalMs: 12057, failures: 1 },
    { tool: 'view', count: 1, p50Ms: 5, p95Ms: 5, maxMs: 5, totalMs: 5, failures: 0 }
  ]);
  assert.equal(data.percentile([], 95), null);
  assert.equal(data.percentile([3, 1, 2, NaN], 50), 2);
});

test('ui data: token series is cumulative and ends at the session estimate', async t => {
  const fixture = createUiFixture('series');
  t.after(fixture.cleanup);
  const detail = await storeFor(fixture).detail(FAILED_ID);
  const series = detail.tokenSeries;
  assert.equal(series.granularity, 'call');
  assert.equal(series.costBasis, 'session-allocated');
  assert.deepEqual(series.points.map(point => [point.input, point.output]), [[29820, 441], [60000, 500]]);
  assert.ok(series.points[0].costUsd < series.points[1].costUsd);
  assert.equal(series.points.at(-1).costUsd, detail.run.costUsd);

  const sessionOnly = data.tokenSeries([], { 'claude-haiku-4.5': { input: 1000, output: 0 } }, 5000);
  assert.deepEqual(sessionOnly, { granularity: 'session', points: [{ tMs: 5000, input: 1000, output: 0, costUsd: 0.001 }] });
  assert.deepEqual(data.tokenSeries([], {}, 0), { granularity: 'none', points: [] });
  const unpriced = data.tokenSeries([{ kind: 'chat', startMs: 0, durationMs: 1, attrs: { model: 'mystery-model', inputTokens: 10, outputTokens: 1 } }], {}, 1);
  assert.equal(unpriced.costBasis, 'per-call');
  assert.equal(unpriced.points[0].costUsd, null);
});

test('ui data: KPIs, facets and filters aggregate the visible runs', async t => {
  const fixture = createUiFixture('kpis');
  t.after(fixture.cleanup);
  const store = storeFor(fixture);
  const all = await store.list();
  assert.equal(all.totalSessions, 3);
  assert.equal(all.scanned, 3);
  assert.deepEqual(all.kpis, {
    runs: 3, failedRuns: 2, failures: 2, toolCalls: 5, p95ToolMs: 12000,
    tokens: { input: 61000, output: 510, runsWithTokens: 2 },
    premiumRequests: 0.33, costUsd: 0.0195, costRuns: 1, unpricedRuns: 1
  });
  assert.deepEqual(all.facets.statuses, [{ value: 'failed', count: 2 }, { value: 'incomplete', count: 1 }]);

  assert.deepEqual((await store.list({ model: 'gpt-6.1-sol' })).runs.map(run => run.id), [OPEN_ID]);
  assert.deepEqual((await store.list({ repo: 'demo-repo' })).runs.map(run => run.id), [FAILED_ID]);
  assert.deepEqual((await store.list({ status: 'failed' })).runs.map(run => run.id), [FAILED_ID, LEDGER_ONLY_ID]);
  assert.deepEqual((await store.list({ q: 'grep timeout' })).runs.map(run => run.id), []);
  assert.deepEqual((await store.list({ q: 'GREP failed' })).runs.map(run => run.id), [LEDGER_ONLY_ID]);
  const none = await store.list({ q: 'no-such-run' });
  assert.equal(none.kpis.costUsd, null);
  assert.equal(none.kpis.p95ToolMs, null);
  assert.equal(none.facets.models.length, 2, 'facets describe all analysed runs, not just matches');

  const limited = await storeFor(fixture, { limit: 1 }).list();
  assert.equal(limited.scanned, 1);
  assert.equal(limited.totalSessions, 3);
});

test('ui data: findEntry resolves latest, run IDs and rejects unsafe IDs', async t => {
  const fixture = createUiFixture('find');
  t.after(fixture.cleanup);
  const store = storeFor(fixture);
  assert.equal(store.findEntry('latest').id, FAILED_ID);
  assert.equal(store.findEntry(RUN_ID).id, FAILED_ID);
  assert.equal(store.findEntry(LEDGER_ONLY_RUN_ID).id, LEDGER_ONLY_ID);
  assert.equal(store.findEntry('../etc/passwd'), null);
  assert.equal(store.findEntry(42), null);
  assert.equal(await store.detail('missing-session'), null);
  assert.equal((await store.detail(LEDGER_ONLY_RUN_ID)).allowContent, false, 'ledger-only runs have no local content');
});

test('ui data: cached rows refresh when the session file changes', async t => {
  const fixture = createUiFixture('cache');
  t.after(fixture.cleanup);
  let clock = fixture.now();
  const store = storeFor(fixture, { now: () => clock });
  assert.equal((await store.list()).runs.length, 3);
  const file = path.join(fixture.copilotHome, 'session-state', OPEN_ID, 'events.jsonl');
  fs.appendFileSync(file, `${JSON.stringify({ type: 'session.shutdown', timestamp: new Date(T0 + 600).toISOString(), data: { modelMetrics: {} } })}\n`);
  clock += 6000;
  const row = (await store.list()).runs.find(run => run.id === OPEN_ID);
  assert.equal(row.status, 'ok');
});

test('ui data: a cached live session turns incomplete once it goes quiet', async t => {
  const fixture = createUiFixture('stale-live');
  t.after(fixture.cleanup);
  let clock = T0 - 86400000 + 1000;
  const store = storeFor(fixture, { now: () => clock });
  assert.equal((await store.list()).runs.find(run => run.id === OPEN_ID).status, 'live');
  clock += 6 * 60 * 1000;
  assert.equal((await store.list()).runs.find(run => run.id === OPEN_ID).status, 'incomplete');
});

test('ui data: content is redacted, truncated and only served with allowContent', async t => {
  const fixture = createUiFixture('content');
  t.after(fixture.cleanup);
  const store = storeFor(fixture, { allowContent: true });
  const detail = await store.detail(FAILED_ID);
  assert.equal(detail.allowContent, true);
  assertNoSecrets(detail, 'detail with allowContent');
  const content = await store.content(FAILED_ID);
  assert.equal(content.prompts.length, 1);
  assert.match(content.prompts[0].text, /PROMPT_CANARY_7f3a/);
  assert.match(content.tools.toolu_ok.arguments, /ARG_CANARY_91bc/);
  assert.match(content.tools.toolu_ok.result, /RESULT_CANARY_02de/);
  assert.match(content.tools.toolu_denied.error, /ERROR_CANARY_c4d1/);
  assert.equal(await store.content(LEDGER_ONLY_ID), null);

  const file = path.join(fixture.root, 'long.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'tool.execution_complete', data: { toolCallId: 'x', result: { content: 'y'.repeat(5000) } } })}\n`);
  const long = await data.readSessionContent(file);
  assert.match(long.tools.x.result, /\[truncated\]$/);
  assert.ok(long.tools.x.result.length < 4100);
});

test('ui data: discovery tolerates missing homes and malformed ledger files', async t => {
  const fixture = createUiFixture('missing');
  t.after(fixture.cleanup);
  const empty = data.discoverSessions({ copilotHome: path.join(fixture.root, 'nope'), agentOpsHome: path.join(fixture.root, 'nope') });
  assert.deepEqual(empty.sessions, []);
  fs.mkdirSync(path.join(fixture.agentOpsHome, 'runs', 'broken_run'), { recursive: true });
  fs.writeFileSync(path.join(fixture.agentOpsHome, 'runs', 'broken_run', 'run-context.json'), '{not json');
  assert.equal(data.readLedgerIndex(fixture.agentOpsHome).size, 2);
  assert.deepEqual(data.readLedgerSpans(path.join(fixture.root, 'nope')), []);
  const parsed = await data.readSessionEvents(path.join(fixture.copilotHome, 'session-state', FAILED_ID, 'events.jsonl'));
  assert.equal(parsed.malformed, 0, 'truncated untracked lines are skipped without parsing');
  const broken = path.join(fixture.root, 'broken.jsonl');
  fs.writeFileSync(broken, '{"type":"tool.execution_start","data":{\n\n');
  assert.equal((await data.readSessionEvents(broken)).malformed, 1);
  assert.equal(parsed.firstTime, T0);
  assert.equal(parsed.lastTime, T0 + 44000);
  assert.equal(data.defaultCopilotHome({ COPILOT_HOME: '/x' }), '/x');
  assert.equal(data.defaultAgentOpsHome({ AGENTOPS_HOME: '/y' }), '/y');
});

test('ui data: buildSpans nests subagents under their task call and adds compaction spans', () => {
  const events = [
    { type: 'session.start', time: 0 },
    { type: 'assistant.turn_start', time: 1, turnId: '0', agentId: '' },
    { type: 'tool.execution_start', time: 2, toolCallId: 'task1', toolName: 'task', turnId: '0', agentId: '' },
    { type: 'subagent.started', time: 3, toolCallId: 'task1', agentId: '', agentName: 'explore', model: 'gpt-6-luna' },
    { type: 'assistant.turn_start', time: 4, turnId: '0', agentId: 'task1' },
    { type: 'tool.execution_start', time: 5, toolCallId: 'grep1', toolName: 'grep', turnId: '0', agentId: 'task1' },
    { type: 'tool.execution_complete', time: 6, toolCallId: 'grep1', success: true, outcome: 'ok', agentId: 'task1' },
    { type: 'assistant.turn_end', time: 7, turnId: '0', agentId: 'task1' },
    { type: 'subagent.failed', time: 8, toolCallId: 'task1', agentId: '' },
    { type: 'tool.execution_complete', time: 9, toolCallId: 'task1', success: false, outcome: 'failed', agentId: '' },
    { type: 'tool.execution_complete', time: 9, toolCallId: 'orphan', success: true, outcome: 'ok', agentId: '' },
    { type: 'hook.start', time: 9, hookId: 'h', hookType: 'postToolUse', agentId: '' },
    { type: 'hook.end', time: 10, hookId: 'h', hookType: 'postToolUse', success: false, agentId: '' },
    { type: 'assistant.turn_end', time: 10, turnId: '0', agentId: '' },
    { type: 'session.compaction_start', time: 11 },
    { type: 'session.compaction_complete', time: 12 }
  ];
  const { spans } = data.buildSpans(events, [], { firstTime: 0, lastTime: 12 });
  const shape = spans.map(span => `${'  '.repeat(span.depth)}${span.kind}:${span.name}:${span.status}`);
  assert.deepEqual(shape, [
    'session:session:ok',
    '  turn:turn 1:ok',
    '    tool:task:failed',
    '      agent:explore:failed',
    '        turn:turn 1:ok',
    '          tool:grep:ok',
    '    hook:postToolUse:failed',
    '  tool:unknown-tool:ok',
    '  compaction:context compaction:ok'
  ]);
});

test('ui data: failureSentence pluralises and uses outcomes', () => {
  assert.equal(data.failureSentence({ kind: 'tool', name: 'bash', outcome: 'denied', count: 1 }), '1 tool call denied: bash');
  assert.equal(data.failureSentence({ kind: 'hook', name: 'preToolUse', outcome: 'failed', count: 2 }), '2 hooks failed: preToolUse');
  const kpis = data.aggregateKpis([]);
  assert.equal(kpis.runs, 0);
  assert.equal(data.matchesFilters({ models: [], model: '', repo: { name: '', hash: 'abc' }, toolNames: [], status: 'ok', id: 'x' }, { repo: 'abc' }), true);
  assert.deepEqual(data.publicRow({ a: 1, _toolDurations: [], usageByModel: {} }), { a: 1 });
  assert.ok(data.TRACKED_TYPES.has('tool.execution_complete'));
  assert.equal(data.TRACKED_TYPES.has('assistant.message'), false);
});
