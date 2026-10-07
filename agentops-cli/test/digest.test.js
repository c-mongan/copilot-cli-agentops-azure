const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  classifyToolFailure,
  clusterFailures,
  deniedRuleTool,
  fingerprintOf,
  safeToolLabel
} = require('../src/lib/digest/failure-clusters');
const {
  buildDigest,
  inWindow,
  parsePeriod,
  percentile,
  periodWindows,
  slowestTools,
  trendValue
} = require('../src/lib/digest/digest-summary');
const { estimateCost, loadPriceTable } = require('../src/lib/digest/pricing');
const { readLocalSessions, summarizeSessionEvents } = require('../src/lib/digest/session-metadata');
const { digestCommand, digestFormat } = require('../src/lib/digest-command');
const { renderDigestHtml } = require('../src/lib/digest/render-html');
const { renderDigestMarkdown } = require('../src/lib/digest/render-markdown');
const { coreCommands, usage } = require('../src/lib/cli-surface');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const SECRET_PROMPT = 'SECRET-PROMPT-please-leak-me';
const SECRET_ARG = 'SECRET-ARG-token=hunter2';
const SECRET_RESULT = 'SECRET-RESULT-body';
const SECRET_ERROR = 'SECRET-ERROR-stack-trace /Users/someone/private';

function iso(ms) {
  return new Date(ms).toISOString();
}

function failure(tool, errorType, model, at, runId, repo = 'repo:aaaa1111') {
  return { tool, errorType, model, at, runId, sessionId: runId, repo };
}

function sessionEvents({ sessionId, startMs, model = 'claude-haiku-4.5', gitRoot = '/work/private-repo', deniedCurl = true }) {
  let t = startMs;
  const at = () => iso((t += 1000));
  const events = [
    { type: 'session.start', timestamp: iso(startMs), data: { sessionId, startTime: iso(startMs), selectedModel: model, context: { cwd: gitRoot, gitRoot } } },
    { type: 'user.message', timestamp: at(), data: { content: SECRET_PROMPT } },
    { type: 'tool.execution_start', timestamp: at(), data: { toolCallId: 'c1', toolName: 'bash', model, arguments: { command: `curl -H "${SECRET_ARG}" https://example.com` } } }
  ];
  if (deniedCurl) {
    events.push({ type: 'tool.execution_complete', timestamp: at(), data: { toolCallId: 'c1', model, success: false, error: { code: 'denied', message: `Permission to run this tool was denied due to the following rules: \`shell(curl:*)\` ${SECRET_ERROR}` } } });
  } else {
    events.push({ type: 'tool.execution_complete', timestamp: at(), data: { toolCallId: 'c1', model, success: true, result: { content: SECRET_RESULT } } });
  }
  events.push(
    { type: 'tool.execution_start', timestamp: at(), data: { toolCallId: 'c2', toolName: 'view', model, arguments: { path: SECRET_ARG } } },
    { type: 'tool.execution_complete', timestamp: at(), data: { toolCallId: 'c2', model, success: true, result: { content: SECRET_RESULT } } },
    { type: 'assistant.message', timestamp: at(), data: { content: SECRET_RESULT } },
    { type: 'session.shutdown', timestamp: at(), data: { totalPremiumRequests: 1, modelMetrics: { [model]: { usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 0 } } } } }
  );
  return events;
}

function writeFixtureHomes(root) {
  const copilotHome = path.join(root, 'copilot');
  const agentopsHome = path.join(root, 'agentops');
  const sessions = [
    { sessionId: 'sess-a', startMs: NOW - 1 * DAY },
    { sessionId: 'sess-b', startMs: NOW - 2 * DAY },
    { sessionId: 'sess-c', startMs: NOW - 3 * DAY, deniedCurl: false, model: 'gpt-unpriced' },
    { sessionId: 'sess-old', startMs: NOW - 9 * DAY, deniedCurl: false }
  ];
  for (const session of sessions) {
    const dir = path.join(copilotHome, 'session-state', session.sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const lines = sessionEvents(session).map(event => JSON.stringify(event));
    lines.push('{not json');
    fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.join('\n')}\n`);
  }
  const runDir = path.join(agentopsHome, 'runs', 'native_run_a');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-context.json'), JSON.stringify({ runId: 'native_run_a', sessionId: 'sess-a', createdAt: iso(NOW - DAY) }));
  return { copilotHome, agentopsHome };
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-digest-test-'));
  try {
    return fn(writeFixtureHomes(root), root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function captureStdout() {
  let text = '';
  return { stream: { write: chunk => { text += chunk; return true; } }, text: () => text };
}

test('denied rule extraction keeps only the allowlisted rule label', () => {
  assert.equal(deniedRuleTool('denied due to the following rules: `shell(curl:*)`'), 'shell(curl)');
  assert.equal(deniedRuleTool('rules: `shell(curl)`'), 'shell(curl)');
  assert.equal(deniedRuleTool('rules: `shell(curl https://x.test/?a=$(id))`'), '');
  assert.equal(deniedRuleTool('no rule here'), '');
  assert.equal(safeToolLabel('shell(curl)'), 'shell(curl)');
  assert.equal(safeToolLabel('shell(rm -rf; echo $HOME)'), 'unknown-tool');
  const classified = classifyToolFailure({ toolName: 'bash', model: 'm' }, { success: false, error: { code: 'denied', message: 'rules: `shell(curl:*)`' } });
  assert.deepEqual(classified, { tool: 'shell(curl)', errorType: 'denied', model: 'm' });
  assert.equal(fingerprintOf(classified), 'shell(curl)|denied|m');
  assert.equal(fingerprintOf({ tool: 'x', errorType: 'made-up', model: 'm' }), 'x|error|m');
  assert.equal(fingerprintOf({ tool: 'x', errorType: 'error:quota_exceeded', model: 'm' }), 'x|error:quota_exceeded|m');
});

test('failure classification covers timeouts and non-zero shell exits', () => {
  assert.equal(classifyToolFailure({ toolName: 'bash' }, { success: true, shellExecution: { exitCode: 2 } }).errorType, 'nonzero_exit');
  assert.equal(classifyToolFailure({ toolName: 'web_fetch' }, { success: false, error: { message: 'Request timed out after 30s' } }).errorType, 'timeout');
  assert.equal(classifyToolFailure({ toolName: 'bash' }, { success: false, error: { code: 'failure', message: 'boom' } }).model, 'unknown-model');
});

test('failure clustering is deterministic regardless of input order', () => {
  const failures = [
    failure('shell(curl)', 'denied', 'claude-haiku-4.5', '2026-10-05T10:00:00.000Z', 'run-1'),
    failure('shell(curl)', 'denied', 'claude-haiku-4.5', '2026-10-06T10:00:00.000Z', 'run-2', 'repo:bbbb2222'),
    failure('shell(curl)', 'denied', 'gpt-6.1-sol', '2026-10-06T11:00:00.000Z', 'run-3'),
    failure('bash', 'nonzero_exit', 'claude-haiku-4.5', '2026-10-04T10:00:00.000Z', 'run-1'),
    failure('bash', 'nonzero_exit', 'claude-haiku-4.5', '2026-10-04T09:00:00.000Z', 'run-1'),
    failure('web_fetch', 'timeout', 'gpt-6.1-sol', '2026-10-03T09:00:00.000Z', 'run-4')
  ];
  const first = clusterFailures(failures);
  for (let i = 0; i < 5; i += 1) {
    const shuffled = [...failures].sort(() => Math.random() - 0.5);
    assert.deepEqual(clusterFailures(shuffled), first);
  }
  assert.equal(first.headline, '6 failures in 4 clusters');
  assert.deepEqual(first.clusters.map(c => c.fingerprint), [
    'bash|nonzero_exit|claude-haiku-4.5',
    'shell(curl)|denied|claude-haiku-4.5',
    'shell(curl)|denied|gpt-6.1-sol',
    'web_fetch|timeout|gpt-6.1-sol'
  ]);
  const curl = first.clusters[1];
  assert.match(curl.id, /^fc_[0-9a-f]{10}$/);
  assert.equal(curl.count, 2);
  assert.equal(curl.firstSeen, '2026-10-05T10:00:00.000Z');
  assert.equal(curl.lastSeen, '2026-10-06T10:00:00.000Z');
  assert.deepEqual(curl.runs, ['run-1', 'run-2']);
  assert.deepEqual(curl.repos, ['repo:aaaa1111', 'repo:bbbb2222']);
  assert.equal(curl.representativeRunId, 'run-2');
  assert.match(curl.suggestedNextStep, /--allow-tool 'shell\(curl\)'/);
  assert.match(curl.suggestedNextStep, /keep it denied deliberately/);
  assert.equal(clusterFailures([]).headline, '0 failures in 0 clusters');
  assert.equal(clusterFailures([failures[0]]).headline, '1 failure in 1 cluster');
});

test('period parsing, windows and boundaries', () => {
  assert.deepEqual(parsePeriod('7d').periodMs, 7 * DAY);
  assert.equal(parsePeriod('24h').periodMs, DAY);
  assert.equal(parsePeriod('2w').periodMs, 14 * DAY);
  assert.throws(() => parsePeriod('7x'), /--since/);
  assert.throws(() => parsePeriod('400d'), /365d/);
  const windows = periodWindows(NOW, 7 * DAY);
  assert.equal(windows.current.startMs, NOW - 7 * DAY);
  assert.equal(windows.previous.endMs, windows.current.startMs);
  const boundary = iso(NOW - 7 * DAY);
  assert.equal(inWindow(boundary, windows.current), true);
  assert.equal(inWindow(boundary, windows.previous), false);
  assert.equal(inWindow(iso(NOW), windows.current), false);
  assert.equal(inWindow(iso(NOW), windows.current, true), true);
  assert.equal(inWindow('not a date', windows.current), false);
});

test('trend maths handles counts, rates and a zero baseline', () => {
  assert.deepEqual(trendValue(15, 10), { current: 15, previous: 10, delta: 5, pctChange: 0.5, kind: 'count' });
  assert.equal(trendValue(5, 10).pctChange, -0.5);
  assert.equal(trendValue(3, 0).pctChange, null);
  assert.equal(trendValue(0, 0).pctChange, 0);
  const rate = trendValue(0.8, 0.6, 'rate');
  assert.ok(Math.abs(rate.delta - 0.2) < 1e-9);
  assert.equal(rate.pctChange, null);
  assert.equal(trendValue(null, 4).delta, null);
});

test('percentile and slowest tools exclude wait tools', () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([], 95), null);
  const sessions = [{ toolDurations: [
    ...[100, 200, 300].map(ms => ({ tool: 'bash', ms })),
    ...[9000, 9000, 9000].map(ms => ({ tool: 'read_bash', ms })),
    { tool: 'view', ms: 5 }
  ] }];
  const slow = slowestTools(sessions);
  assert.deepEqual(slow.map(entry => entry.tool), ['bash']);
  assert.equal(slow[0].p95Ms, 300);
});

test('session summary dedupes completions and uses the last cumulative shutdown', () => {
  const events = [
    { type: 'session.start', timestamp: iso(NOW), data: { sessionId: 's1', selectedModel: 'm', context: { gitRoot: '/r' } } },
    { type: 'tool.execution_start', timestamp: iso(NOW + 1000), data: { toolCallId: 't1', toolName: 'bash', model: 'm' } },
    { type: 'tool.execution_complete', timestamp: iso(NOW + 3000), data: { toolCallId: 't1', model: 'm', success: true } },
    { type: 'tool.execution_complete', timestamp: iso(NOW + 3000), data: { toolCallId: 't1', model: 'm', success: true } },
    { type: 'session.shutdown', timestamp: iso(NOW + 4000), data: { totalPremiumRequests: 1, modelMetrics: { m: { usage: { inputTokens: 100, outputTokens: 10 } } } } },
    { type: 'session.shutdown', timestamp: iso(NOW + 9000), data: { totalPremiumRequests: 2, modelMetrics: { m: { usage: { inputTokens: 250, outputTokens: 30 } } } } }
  ];
  const summary = summarizeSessionEvents(events);
  assert.equal(summary.toolCalls, 1);
  assert.deepEqual(summary.toolDurations, [{ tool: 'bash', ms: 2000 }]);
  assert.equal(summary.premiumRequests, 2);
  assert.equal(summary.tokenSource, 'session.shutdown');
  assert.equal(summary.tokensByModel.m.inputTokens, 250);
  assert.equal(summary.tokensByModel.m.outputTokens, 30);
  assert.match(summary.repo, /^repo:[0-9a-f]{8}$/);
  assert.equal(summarizeSessionEvents(events, { repoNames: true }).repo, 'r');
});

test('model call usage is a deduplicated fallback when no shutdown exists', () => {
  const call = { type: 'model.model_call_success', timestamp: iso(NOW + 1000), data: { callId: 'k1', modelCall: { model: 'm' }, responseChunk: { usage: { prompt_tokens: 50, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 20 } } } } };
  const summary = summarizeSessionEvents([
    { type: 'session.start', timestamp: iso(NOW), data: { sessionId: 's2' } },
    call,
    call,
    { type: 'abort', timestamp: iso(NOW + 2000), data: {} }
  ]);
  assert.equal(summary.tokenSource, 'model.call');
  assert.deepEqual(summary.tokensByModel.m, { inputTokens: 50, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 0 });
  assert.equal(summary.aborted, true);
});

test('cost estimate is labelled and unavailable without a price', () => {
  const price = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
  const cost = estimateCost({ inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 600_000, cacheWriteTokens: 0 }, price);
  assert.ok(Math.abs(cost - (0.4 + 0.5 + 0.06)) < 1e-9);
  assert.equal(estimateCost({ inputTokens: 10 }, undefined), null);
  const prices = loadPriceTable();
  assert.match(prices.label, /estimate/i);
  withFixture((homes, root) => {
    const file = path.join(root, 'prices.json');
    fs.writeFileSync(file, JSON.stringify({ 'gpt-unpriced': { input: 1, output: 2 } }));
    assert.ok(loadPriceTable(file).table['gpt-unpriced']);
    fs.writeFileSync(file, JSON.stringify({ bad: { input: -1 } }));
    assert.throws(() => loadPriceTable(file));
  });
});

test('local reader filters by period, links ledger runs and tolerates malformed rows', () => {
  withFixture(homes => {
    const read = readLocalSessions({ ...homes, sinceMs: 0 });
    assert.equal(read.sessions.length, 4);
    assert.equal(read.stats.malformedRows, 4);
    assert.equal(read.stats.linkedRuns, 1);
    const linked = read.sessions.find(session => session.sessionId === 'sess-a');
    assert.equal(linked.runId, 'native_run_a');
    assert.equal(linked.failures[0].runId, 'native_run_a');

    const digest = buildDigest({ sessions: read.sessions, nowMs: NOW, period: parsePeriod('7d'), prices: loadPriceTable() });
    assert.equal(digest.schema, 'agentops.digest.v1');
    assert.equal(digest.current.sessions, 3);
    assert.equal(digest.previous.sessions, 1);
    assert.equal(digest.trend.sessions.pctChange, 2);
    assert.equal(digest.failureClusters.headline, '2 failures in 1 cluster');
    assert.equal(digest.failureClusters.clusters[0].fingerprint, 'shell(curl)|denied|claude-haiku-4.5');
    assert.equal(digest.current.tokens.costStatus, 'partial');
    assert.deepEqual(digest.current.tokens.unpricedModels, ['gpt-unpriced']);
    assert.ok(digest.recommendations.length >= 1 && digest.recommendations.length <= 3);
  });
});

test('digest output never contains prompt, argument, result or error text', () => {
  withFixture(homes => {
    const read = readLocalSessions({ ...homes, sinceMs: 0 });
    const digest = buildDigest({ sessions: read.sessions, nowMs: NOW, period: parsePeriod('7d'), prices: loadPriceTable() });
    const outputs = [JSON.stringify(digest), renderDigestMarkdown(digest), renderDigestHtml(digest)];
    for (const output of outputs) {
      for (const secret of [SECRET_PROMPT, SECRET_ARG, SECRET_RESULT, SECRET_ERROR, 'hunter2', 'example.com', 'private-repo', '/work/']) {
        assert.equal(output.includes(secret), false, `leaked ${secret}`);
      }
    }
    const html = outputs[2];
    assert.match(html, /^<!doctype html>/i);
    assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)=["']https?:/i);
    assert.match(html, /prefers-color-scheme: dark/);
  });
});

test('digest command writes files, infers format and is registered in the CLI', () => {
  assert.equal(digestFormat(['--output', 'x.html']), 'html');
  assert.equal(digestFormat(['--output', 'x.json']), 'json');
  assert.equal(digestFormat(['--format', 'markdown']), 'md');
  assert.equal(digestFormat(['--json']), 'json');
  assert.equal(digestFormat([]), 'md');
  assert.throws(() => digestFormat(['--format', 'pdf']), /md, html or json/);
  assert.ok(coreCommands.includes('digest'));
  assert.match(usage(), /\n  digest \[--since 7d\]/);
  assert.match(usage('digest'), /^agentops digest \[--since 7d\]/);

  withFixture((homes, root) => {
    const homeArgs = ['--copilot-home', homes.copilotHome, '--agentops-home', homes.agentopsHome];
    const out = captureStdout();
    const target = path.join(root, 'out', 'digest.html');
    digestCommand(['--since', '7d', '--output', target, ...homeArgs], { stdout: out.stream, nowMs: NOW });
    assert.match(out.text(), /2 failures in 1 cluster; 3 session\(s\) in the last 7d/);
    assert.match(fs.readFileSync(target, 'utf8'), /<html/);

    const md = captureStdout();
    digestCommand(homeArgs, { stdout: md.stream, nowMs: NOW });
    assert.match(md.text(), /2 failures in 1 cluster/);
    assert.match(md.text(), /shell\(curl\)/);

    const help = captureStdout();
    digestCommand(['--help'], { stdout: help.stream });
    assert.match(help.text(), /Metadata only/);
  });
});

test('inspect suggestion uses the session id with --run-id for ledger-linked runs', () => {
  const linked = clusterFailures([{ tool: 'bash', errorType: 'nonzero_exit', model: 'm', at: '2026-10-06T10:00:00.000Z', runId: 'native_run_1_abc', sessionId: '4b9daf26-aadc-470c-8649-fe55d1725747' }]);
  assert.match(linked.clusters[0].suggestedNextStep, /copilot-session view 4b9daf26-aadc-470c-8649-fe55d1725747 --run-id native_run_1_abc --output/);
  const sessionOnly = clusterFailures([{ tool: 'bash', errorType: 'nonzero_exit', model: 'm', at: '2026-10-06T10:00:00.000Z', runId: 's-1', sessionId: 's-1' }]);
  assert.match(sessionOnly.clusters[0].suggestedNextStep, /copilot-session view s-1 --output/);
  assert.doesNotMatch(sessionOnly.clusters[0].suggestedNextStep, /--run-id/);
});
