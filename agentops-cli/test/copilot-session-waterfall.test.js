const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { renderSessionWaterfall, sessionWaterfall, writeSessionWaterfall } = require('../src/lib/copilot/session-waterfall');

function fixtureAttachment(skills) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-waterfall-attachment-'));
  fs.mkdirSync(path.join(root, '.agentops'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agentops', 'attachment.json'), JSON.stringify({
    architecture: { skills }
  }));
  return root;
}

const events = [
  { type: 'session.start', timestamp: '2026-01-01T00:00:00.000Z', data: {} },
  { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'a', toolName: 'view', arguments: { path: '<fixture>' } } },
  { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.500Z', data: { toolCallId: 'b', toolName: 'bash' } },
  { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'b', success: false, result: 'failed' } },
  { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03.000Z', data: { toolCallId: 'a', success: true, result: '<content>' } },
  { type: 'session.shutdown', timestamp: '2026-01-01T00:00:04.000Z', data: {} }
];

test('local waterfall pairs overlapping calls by ID and marks failures', () => {
  const { rows, durationMs, coverageGaps } = sessionWaterfall(events);
  assert.equal(durationMs, 4000);
  assert.equal(coverageGaps, 0);
  assert.equal(rows.find(row => row.label === 'view').end - rows.find(row => row.label === 'view').start, 2000);
  assert.equal(rows.find(row => row.label === 'bash').status, 'failed');
  assert.equal(rows.filter(row => row.kind === 'tool.execution_complete').length, 0);
});

test('local waterfall uses nested shell exit code when tool wrapper reports success', () => {
  const run = [
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00.000Z', data: { toolCallId: 'python', toolName: 'bash' } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'python', success: true, shellExecution: { exitCode: 1 } } }
  ];
  assert.equal(sessionWaterfall(run).rows[0].status, 'failed');
});

test('run summary counts incomplete, orphaned, invalid-time, and uncorrelated evidence as coverage gaps', () => {
  const partial = [
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00.000Z', data: { toolCallId: 'started', toolName: 'bash' } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'orphan-completion', success: true } },
    { type: 'assistant.tool_call_delta', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'orphan-request', toolName: 'view', inputDelta: '{}' } },
    { type: 'assistant.message_delta', timestamp: '2026-01-01T00:00:03.000Z', data: { deltaContent: 'uncorrelated' } },
    { type: 'user.message', timestamp: 'invalid-time', data: { content: 'untimed event' } }
  ];
  const summary = sessionWaterfall(partial);
  assert.equal(summary.unresolvedRows, 3);
  assert.equal(summary.invalidTimestamps, 1);
  assert.equal(summary.unmatchedDeltas, 1);
  assert.equal(summary.coverageGaps, 5);
  const html = renderSessionWaterfall(partial, 'partial');
  assert.match(html, /Coverage gaps/);
  assert.match(html, /<strong>5<\/strong><span>Coverage gaps/);
  assert.match(html, /3 operations with missing or incomplete evidence/);
  assert.match(html, /execution not observed/);
  assert.match(html, /completed, start not observed/);
});

test('local waterfall escapes rich content and writes owner-only file without overwriting', () => {
  const html = renderSessionWaterfall(events, 'test<script>');
  assert.match(html, /test&lt;script&gt;/);
  assert.match(html, /&lt;content&gt;/);
  assert.doesNotMatch(html, /<content>|test<script>/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-waterfall-test-'));
  try {
    const output = path.join(directory, 'run.html');
    writeSessionWaterfall(events, 'synthetic', output);
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    assert.throws(() => writeSessionWaterfall(events, 'synthetic', output), /EEXIST/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('metadata-only waterfall omits unknown future payload fields', () => {
  const fixture = [
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00Z', data: { toolCallId: 'call-1', toolName: 'bash', arguments: { command: 'ARG_CANARY' } } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:01Z', data: {
      toolCallId: 'call-1', success: false, result: 'RESULT_CANARY',
      shellExecution: { exitCode: 1, stderr: 'STDERR_CANARY' },
      futurePayload: { body: 'FUTURE_CANARY' }
    } }
  ];
  const html = renderSessionWaterfall(fixture, 'safe-session', { metadataOnly: true });
  assert.match(html, /Metadata only/);
  assert.match(html, /call-1/);
  assert.doesNotMatch(html, /ARG_CANARY|RESULT_CANARY|STDERR_CANARY|FUTURE_CANARY/);
});

// Independent adversarial check of the same guarantee with a different
// fixture (paired start/completion row so the nested `start`/`completion`
// wrapper path is exercised too, a `shellExecution.stdout` sibling of the
// already-covered `stderr`, and a multi-level-deep unknown field under a
// key name nobody has ever declared safe) to confirm the allowlist genuinely
// generalizes rather than happening to match only the field names in one
// specific fixture.
test('metadata-only waterfall drops a multi-level-deep unknown field and shellExecution.stdout, not just the originally reported fields', () => {
  const fixture = [
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00Z', data: { toolCallId: 'call-9', toolName: 'bash' } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:01Z', data: {
      toolCallId: 'call-9',
      success: false,
      result: 'RESULT_CANARY_9',
      shellExecution: { exitCode: 1, stderr: 'STDERR_CANARY_9', stdout: 'STDOUT_CANARY_9' },
      diagnosticsBundle: { trace: { payload: 'DEEP_UNKNOWN_CANARY_9' } }
    } }
  ];
  const html = renderSessionWaterfall(fixture, 'safe-session-9', { metadataOnly: true });
  assert.match(html, /Metadata only/);
  assert.match(html, /call-9/);
  assert.doesNotMatch(html, /RESULT_CANARY_9|STDERR_CANARY_9|STDOUT_CANARY_9|DEEP_UNKNOWN_CANARY_9/);
});

test('failure-first view links preceding context and exact native evidence', () => {
  const failureEvents = [
    { type: 'user.message', timestamp: '2026-01-01T00:00:00.000Z', data: { content: 'Fix the build' } },
    { type: 'assistant.message', timestamp: '2026-01-01T00:00:00.500Z', data: { content: 'I will run the build' } },
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'call-1', toolName: 'bash', arguments: { command: 'npm test' } } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'call-1', success: false, result: 'exit 1 <failed>' } }
  ];
  const nativeSpans = [{ start: Date.parse('2026-01-01T00:00:01.000Z'), end: Date.parse('2026-01-01T00:00:02.000Z'), traceId: 'trace-1', spanId: 'span-1', operation: 'execute_tool', toolName: 'bash', toolCallId: 'call-1', agent: 'copilot', failed: true }];
  const html = renderSessionWaterfall(failureEvents, 'fixture', { nativeSpans });
  assert.match(html, /1 failure signal observed/);
  assert.match(html, /Failure detail/);
  assert.match(html, /exit 1 &lt;failed&gt;/);
  assert.match(html, /Fix the build/);
  assert.match(html, /&quot;command&quot;:&quot;npm test&quot;/);
  assert.match(html, /href="#event-0">User message/);
  assert.match(html, /href="#event-1">Assistant message/);
  assert.match(html, /href="#event-3">Matching native span/);
  assert.match(html, /data-filter="failed"/);
  assert.match(html, /Trace trace-1/);
  assert.doesNotMatch(html, /exit 1 <failed>/);
});

test('failed run-linked script failure points to its related tool call with inferred evidence', () => {
  const events = [
    { type: 'user.message', timestamp: '2026-01-01T00:00:00.000Z', data: { content: 'Run the failing script' } },
    { type: 'assistant.message', timestamp: '2026-01-01T00:00:00.500Z', data: { content: 'I will run it' } },
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'call-python', toolName: 'bash', arguments: { command: 'python3 scripts/fail.py' } } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'call-python', success: false, shellExecution: { exitCode: 1 } } }
  ];
  const nativeSpans = [{
    start: Date.parse('2026-01-01T00:00:01.500Z'), end: Date.parse('2026-01-01T00:00:01.500Z'),
    traceId: 'trace-script', spanId: 'span-script', operation: 'script.execute', scriptName: 'scripts/fail.py',
    toolCallId: 'call-python', toolCallEvidence: 'inferred-unique-session-tool-event-window',
    match: 'run-linked-script', failed: true, errorType: 'RuntimeError'
  }];
  const html = renderSessionWaterfall(events, 'script-failure', { nativeSpans });
  assert.match(html, /scripts\/fail\.py/);
  assert.match(html, /Related tool call · inferred from a unique session tool event window/);
  assert.match(html, /href="#event-2">Related tool call · inferred from a unique session tool event window/);
  assert.match(html, /No physical parent is claimed/);
});

test('waterfall displays retained fractional milliseconds instead of turning a sub-millisecond span into a point', () => {
  const html = renderSessionWaterfall([], 'submillisecond', { nativeSpans: [{
    start: 1767225601000.123, end: 1767225601000.456,
    durationMs: 0.333,
    traceId: 'trace-submillisecond', spanId: 'span-submillisecond', operation: 'script.execute',
    scriptName: 'scripts/fast.py', match: 'run-linked-script', failed: false
  }] });
  assert.match(html, /0\.333 ms/);
  assert.doesNotMatch(html, /point event/);
});

test('empty failure view does not claim a run succeeded', () => {
  const html = renderSessionWaterfall(events.filter(event => event.data?.success !== false), 'fixture');
  assert.match(html, /No failure signal was observed in the available evidence/);
  assert.match(html, /This does not prove the run succeeded/);
});

test('waterfall reports per-stream delivery without exposing target details or claiming Azure readback', () => {
  const html = renderSessionWaterfall(events, 'delivery-state', { deliveryStatus: {
    runId: 'run-private-target',
    target: { subscriptionId: 'subscription-secret-id', logsIngestionEndpoint: 'https://private.example', dcrImmutableId: 'dcr-secret-id' },
    streams: {
      events: { status: 'azure_accepted', rows: 12, attempts: 1 },
      spans: { status: 'in_flight', rows: 7, attempts: 2 }
    }
  } });
  assert.match(html, /Evidence delivery/);
  assert.match(html, /Azure accepted · readback unverified/);
  assert.match(html, /In flight · recovery may be needed/);
  assert.match(html, /12 rows · 1 attempts/);
  assert.match(html, /7 rows · 2 attempts/);
  assert.match(html, /Azure acceptance does not prove that rows are indexed or queryable/);
  assert.doesNotMatch(html, /subscription-secret-id|private\.example|dcr-secret-id/);
});

test('native-only failures remain visible when no session failure has an exact tool-call join', () => {
  const nativeSpans = [{ start: Date.parse('2026-01-01T00:00:01.000Z'), end: Date.parse('2026-01-01T00:00:02.000Z'), traceId: 'trace-only', spanId: 'span-only', operation: 'invoke_agent', agent: 'worker', failed: true }];
  const html = renderSessionWaterfall([], 'native-only-failure', { nativeSpans });
  assert.match(html, /1 failure signal observed/);
  assert.match(html, /<h3>invoke_agent<\/h3>/);
});

test('native skill invocation appears at its event time on the waterfall', () => {
  const nativeSpans = [{
    start: 1767225601000, end: 1767225603000, traceId: 'trace-1', spanId: 'root',
    operation: 'invoke_agent', agent: 'fixture-agent', failed: false,
    events: [{ time: 1767225602000, name: 'github.copilot.skill.invoked', attributes: { 'github.copilot.skill.name': 'fixture-flow' } }]
  }];
  const { rows, nativeSpans: count } = sessionWaterfall([], nativeSpans);
  assert.equal(count, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].label, 'skill: fixture-flow');
  assert.equal(rows[1].start, 1767225602000);
  assert.match(renderSessionWaterfall([], 'fixture', { nativeSpans }), /skill: fixture-flow/);
});

test('declared reference reads become metadata-only waterfall rows with inferred or missing skill links and read counts', () => {
  const reference = '.github/skills/build-check/references/guide.md';
  const missingSkillReference = '.github/skills/release-check/references/release.md';
  const root = fixtureAttachment([
    { name: 'build-check', references: [{ path: reference }] },
    { name: 'release-check', references: [{ path: missingSkillReference }] }
  ]);
  try {
    const items = [
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.000Z', data: { name: 'build-check' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'read-1', toolName: 'view', arguments: { path: path.join(root, reference) } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:01.100Z', data: { toolCallId: 'read-1', success: true, result: 'PRIVATE_REFERENCE_CONTENT' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'read-2', toolName: 'view', arguments: { path: reference } } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:03.000Z', data: { toolCallId: 'read-missing-skill', toolName: 'view', arguments: { path: missingSkillReference } } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:04.000Z', data: { toolCallId: 'private-read', toolName: 'view', arguments: { path: 'private/unlisted.md' } } }
    ];
    const { rows } = sessionWaterfall(items, [], { repoRoot: root });
    const references = rows.filter(row => row.kind === 'reference.read');
    assert.equal(references.length, 3);
    assert.deepEqual(references.map(row => row.label), [
      `reference: ${reference}`,
      `reference: ${reference}`,
      `reference: ${missingSkillReference}`
    ]);
    assert.deepEqual(references.map(row => row.details.readCount), [1, 2, 1]);
    assert.deepEqual(references.map(row => row.details.toolCallLink), [
      { evidence: 'exact', toolCallId: 'read-1' },
      { evidence: 'exact', toolCallId: 'read-2' },
      { evidence: 'exact', toolCallId: 'read-missing-skill' }
    ]);
    assert.deepEqual(references[0].details.owningSkillLink, {
      evidence: 'inferred',
      skillName: 'build-check',
      candidates: ['build-check']
    });
    assert.deepEqual(references[1].details.owningSkillLink, {
      evidence: 'inferred',
      skillName: 'build-check',
      candidates: ['build-check']
    });
    assert.deepEqual(references[2].details.owningSkillLink, {
      evidence: 'missing',
      skillName: '',
      candidates: []
    });
    assert.doesNotMatch(JSON.stringify(references), /PRIVATE_REFERENCE_CONTENT|private\/unlisted\.md/);
    const html = renderSessionWaterfall(items, 'references', { repoRoot: root });
    assert.match(html, /reference: \.github\/skills\/build-check\/references\/guide\.md/);
    assert.match(html, /&quot;readCount&quot;: 2/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rendered reference-read tool details omit arguments and results in standard waterfall output', () => {
  const reference = '.github/skills/build-check/references/guide.md';
  const root = fixtureAttachment([
    { name: 'build-check', references: [{ path: reference }] }
  ]);
  try {
    const html = renderSessionWaterfall([
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.000Z', data: { name: 'build-check' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'read-1', toolName: 'view', arguments: { path: reference, secret: 'PRIVATE_ARGUMENT' } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:01.100Z', data: { toolCallId: 'read-1', success: true, result: 'PRIVATE_REFERENCE_CONTENT' } }
    ], 'references', { repoRoot: root });
    assert.match(html, /reference: \.github\/skills\/build-check\/references\/guide\.md/);
    assert.match(html, /&quot;referenceRead&quot;: true/);
    assert.doesNotMatch(html, /PRIVATE_ARGUMENT|PRIVATE_REFERENCE_CONTENT|&quot;arguments&quot;|&quot;result&quot;/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reference skill relationship is ambiguous when multiple earlier same-lane invoked skills declare it', () => {
  const reference = '.github/skills/shared/references/guide.md';
  const root = fixtureAttachment([
    { name: 'alpha', references: [{ path: reference }] },
    { name: 'beta', references: [{ path: reference }] }
  ]);
  try {
    const { rows } = sessionWaterfall([
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.000Z', data: { name: 'alpha' } },
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.500Z', data: { name: 'beta' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'read-shared', toolName: 'view', arguments: { path: reference } } }
    ], [], { repoRoot: root });
    assert.deepEqual(rows.find(row => row.kind === 'reference.read').details.owningSkillLink, {
      evidence: 'ambiguous',
      skillName: '',
      candidates: ['alpha', 'beta']
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('same-timestamp earlier skill invocation can infer reference ownership by source order', () => {
  const reference = '.github/skills/build-check/references/guide.md';
  const root = fixtureAttachment([
    { name: 'build-check', references: [{ path: reference }] }
  ]);
  try {
    const { rows } = sessionWaterfall([
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:01.000Z', data: { name: 'build-check' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'read-1', toolName: 'view', arguments: { path: reference } } }
    ], [], { repoRoot: root });
    assert.deepEqual(rows.find(row => row.kind === 'reference.read').details.owningSkillLink, {
      evidence: 'inferred',
      skillName: 'build-check',
      candidates: ['build-check']
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('subagent reference reads stay in the subagent lane under the parent tool call', () => {
  const reference = '.github/skills/worker-skill/references/guide.md';
  const root = fixtureAttachment([
    { name: 'worker-skill', references: [{ path: reference }] }
  ]);
  try {
    const { rows } = sessionWaterfall([
      { type: 'subagent.started', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'worker-1', data: { toolCallId: 'delegate-1', agentName: 'fixture-worker' } },
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.500Z', agentId: 'worker-1', data: { name: 'worker-skill', parentToolCallId: 'delegate-1' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', agentId: 'worker-1', data: { toolCallId: 'worker-read', parentToolCallId: 'delegate-1', toolName: 'view', arguments: { path: reference } } }
    ], [], { repoRoot: root });
    const row = rows.find(candidate => candidate.kind === 'reference.read');
    assert.equal(row.lane, 'fixture-worker');
    assert.equal(row.details.parentToolCallId, 'delegate-1');
    assert.deepEqual(row.details.toolCallLink, { evidence: 'exact', toolCallId: 'worker-read' });
    assert.deepEqual(row.details.owningSkillLink, {
      evidence: 'inferred',
      skillName: 'worker-skill',
      candidates: ['worker-skill']
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('script internal step spans render as script child rows linked to the parent script span and tool call', () => {
  const nativeSpans = [
    {
      start: Date.parse('2026-01-01T00:00:01.000Z'), end: Date.parse('2026-01-01T00:00:04.000Z'),
      traceId: 'trace-script', spanId: 'script-root', operation: 'script.execute', scriptName: 'scripts/check.py',
      toolCallId: 'call-python', toolCallEvidence: 'inferred-unique-session-tool-event-window',
      match: 'run-linked-script', failed: false
    },
    {
      start: Date.parse('2026-01-01T00:00:02.000Z'), end: Date.parse('2026-01-01T00:00:03.000Z'),
      traceId: 'trace-script', spanId: 'script-step', parentSpanId: 'script-root', operation: 'script.step',
      scriptName: 'scripts/check.py', stepName: 'validate-inputs', toolCallId: 'call-python',
      toolCallEvidence: 'inferred-unique-session-tool-event-window', match: 'run-linked-script', failed: false
    }
  ];
  const { rows } = sessionWaterfall([
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00.500Z', data: { toolCallId: 'call-python', toolName: 'bash', arguments: { command: 'python scripts/check.py' } } }
  ], nativeSpans);
  const script = rows.find(row => row.label === 'script: scripts/check.py');
  const step = rows.find(row => row.label === 'step: validate-inputs');
  assert.equal(step.source, 'script OTel');
  assert.equal(step.details.parentSpanId, 'script-root');
  assert.equal(step.details.toolCallId, 'call-python');
  assert.ok(step.start >= script.start && step.end <= script.end);
  assert.match(renderSessionWaterfall([], 'script-step', { nativeSpans }), /step: validate-inputs/);
});

test('assistant streaming deltas collapse into one timed message while preserving the final text', () => {
  const streaming = [
    { type: 'assistant.message_start', timestamp: '2026-01-01T00:00:00.000Z', data: { messageId: 'message-1' } },
    { type: 'assistant.message_delta', timestamp: '2026-01-01T00:00:00.100Z', data: { messageId: 'message-1', deltaContent: 'Hello ' } },
    { type: 'assistant.message_delta', timestamp: '2026-01-01T00:00:00.200Z', data: { messageId: 'message-1', deltaContent: 'world' } },
    { type: 'assistant.message', timestamp: '2026-01-01T00:00:00.300Z', data: { messageId: 'message-1', content: 'Hello world' } }
  ];
  const { rows } = sessionWaterfall(streaming);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].start, Date.parse('2026-01-01T00:00:00.000Z'));
  assert.equal(rows[0].end, Date.parse('2026-01-01T00:00:00.300Z'));
  assert.equal(rows[0].details.content, 'Hello world');
  assert.deepEqual(rows[0].details.stream, {
    chunks: 2,
    startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    endedAt: Date.parse('2026-01-01T00:00:00.300Z'),
    reconstructedTextMatchesFinal: true
  });
});

test('subagent start and completion form an interval and worker tools use the worker lane', () => {
  const delegated = [
    { type: 'assistant.turn_start', timestamp: '2026-01-01T00:00:00.000Z', data: { turnId: '0' } },
    { type: 'subagent.started', timestamp: '2026-01-01T00:00:01.000Z', agentId: 'worker-1', data: { toolCallId: 'delegate-1', agentName: 'fixture-investigator' } },
    { type: 'assistant.turn_start', timestamp: '2026-01-01T00:00:01.100Z', agentId: 'worker-1', data: { turnId: '0', parentToolCallId: 'delegate-1' } },
    { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02.000Z', agentId: 'worker-1', data: { toolCallId: 'worker-tool-1', toolName: 'agentops-fixture-get_case', parentToolCallId: 'delegate-1' } },
    { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03.000Z', agentId: 'worker-1', data: { toolCallId: 'worker-tool-1', success: true } },
    { type: 'assistant.turn_end', timestamp: '2026-01-01T00:00:04.000Z', agentId: 'worker-1', data: { turnId: '0', parentToolCallId: 'delegate-1' } },
    { type: 'subagent.completed', timestamp: '2026-01-01T00:00:05.000Z', agentId: 'worker-1', data: { toolCallId: 'delegate-1', agentName: 'fixture-investigator' } },
    { type: 'assistant.turn_end', timestamp: '2026-01-01T00:00:06.000Z', data: { turnId: '0' } }
  ];
  const { rows } = sessionWaterfall(delegated);
  const interval = rows.find(row => row.kind === 'subagent.interval');
  assert.equal(interval.label, 'subagent: fixture-investigator');
  assert.equal(interval.end - interval.start, 4000);
  assert.equal(interval.status, 'completed');
  assert.equal(interval.details.start.parentToolCallId, 'delegate-1');
  assert.equal(rows.find(row => row.label === 'agentops-fixture-get_case').lane, 'fixture-investigator');
  assert.equal(rows.filter(row => row.kind === 'assistant.turn_start').length, 2);
  assert.equal(rows.filter(row => row.kind === 'assistant.turn_end').length, 0);
});

test('reasoning deltas are excluded from the rendered timeline and counted as grouped activity', () => {
  const items = [
    { type: 'assistant.reasoning_delta', timestamp: '2026-01-01T00:00:00.000Z', data: { deltaContent: 'private reasoning fixture' } },
    { type: 'session.background_tasks_changed', timestamp: '2026-01-01T00:00:01.000Z', data: {} }
  ];
  const summary = sessionWaterfall(items);
  assert.equal(summary.rows.length, 0);
  assert.equal(summary.suppressedEvents, 2);
  assert.doesNotMatch(renderSessionWaterfall(items, 'fixture'), /private reasoning fixture/);
  assert.match(renderSessionWaterfall(items, 'fixture'), /2 low-level reasoning\/background updates grouped out/);
});

test('deltas without correlation identifiers are counted but never joined to another operation', () => {
  const items = [
    { type: 'assistant.message_delta', timestamp: '2026-01-01T00:00:00.000Z', data: { deltaContent: 'orphan text' } },
    { type: 'assistant.tool_call_delta', timestamp: '2026-01-01T00:00:01.000Z', data: { inputDelta: '{"case_id":"orphan"}' } }
  ];
  const summary = sessionWaterfall(items);
  assert.equal(summary.rows.length, 0);
  assert.equal(summary.unmatchedDeltas, 2);
  assert.match(renderSessionWaterfall(items, 'fixture'), /2 uncorrelated stream deltas not linked/);
  assert.doesNotMatch(renderSessionWaterfall(items, 'fixture'), /orphan text|orphan/);
});

test('a successful direct cat of an undeclared repo path becomes an unsupported reference-read row', () => {
  const reference = '.github/skills/build-check/references/guide.md';
  const undeclaredPath = 'docs/architecture-notes.md';
  const root = fixtureAttachment([
    { name: 'build-check', references: [{ path: reference }] }
  ]);
  try {
    const { rows } = sessionWaterfall([
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'call-undeclared', toolName: 'bash', arguments: { command: `cat ${undeclaredPath}` } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'call-undeclared', toolName: 'bash', success: true, shellExecution: { exitCode: 0 } } }
    ], [], { repoRoot: root });
    const row = rows.find(candidate => candidate.kind === 'reference.read');
    assert.ok(row, 'expected an unsupported reference-read row for an undeclared shell cat');
    assert.equal(row.label, `reference (undeclared): ${undeclaredPath}`);
    assert.equal(row.details.referenceName, undeclaredPath);
    assert.equal(row.details.readCount, 1);
    assert.equal(row.details.declared, false);
    assert.deepEqual(row.details.toolCallLink, { evidence: 'exact', toolCallId: 'call-undeclared' });
    assert.deepEqual(row.details.owningSkillLink, { evidence: 'unsupported', skillName: '', candidates: [] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed, compound, and repo-escaping shell reads never become unsupported reference rows', () => {
  const root = fixtureAttachment([]);
  try {
    const { rows } = sessionWaterfall([
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'call-failed', toolName: 'bash', arguments: { command: 'cat docs/private.md' } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'call-failed', toolName: 'bash', success: false, shellExecution: { exitCode: 1 } } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:03.000Z', data: { toolCallId: 'call-compound', toolName: 'bash', arguments: { command: 'cat docs/private.md && printf PRIVATE_MARKER' } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:04.000Z', data: { toolCallId: 'call-compound', toolName: 'bash', success: true, shellExecution: { exitCode: 0 } } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:05.000Z', data: { toolCallId: 'call-escaping', toolName: 'bash', arguments: { command: 'cat ../outside-repo.md' } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:06.000Z', data: { toolCallId: 'call-escaping', toolName: 'bash', success: true, shellExecution: { exitCode: 0 } } }
    ], [], { repoRoot: root });
    assert.equal(rows.filter(row => row.kind === 'reference.read').length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a reference read nested under another in-flight tool call keeps its parentToolCallId and lane attribution', () => {
  const reference = '.github/skills/build-check/references/guide.md';
  const root = fixtureAttachment([
    { name: 'build-check', references: [{ path: reference }] }
  ]);
  try {
    const { rows } = sessionWaterfall([
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.000Z', data: { name: 'build-check' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'outer-call', toolName: 'orchestrate' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.500Z', data: { toolCallId: 'nested-read', parentToolCallId: 'outer-call', toolName: 'view', arguments: { path: reference } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'nested-read', success: true } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03.000Z', data: { toolCallId: 'outer-call', success: true } }
    ], [], { repoRoot: root });
    const row = rows.find(candidate => candidate.kind === 'reference.read');
    assert.equal(row.details.parentToolCallId, 'outer-call');
    assert.equal(row.lane, 'github-copilot-cli');
    assert.deepEqual(row.details.owningSkillLink, { evidence: 'inferred', skillName: 'build-check', candidates: ['build-check'] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ownership attribution follows the currently-active declaring skill set across A/B/A rereads, not a stale snapshot from the first read', () => {
  const reference = '.github/skills/shared/references/guide.md';
  const root = fixtureAttachment([
    { name: 'checker-a', references: [{ path: reference }] },
    { name: 'checker-b', references: [{ path: reference }] }
  ]);
  try {
    const { rows } = sessionWaterfall([
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.000Z', data: { name: 'checker-a' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'read-1', toolName: 'view', arguments: { path: reference } } },
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:02.000Z', data: { name: 'checker-b' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:03.000Z', data: { toolCallId: 'read-2', toolName: 'view', arguments: { path: reference } } },
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:04.000Z', data: { name: 'checker-a' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:05.000Z', data: { toolCallId: 'read-3', toolName: 'view', arguments: { path: reference } } }
    ], [], { repoRoot: root });
    const references = rows.filter(row => row.kind === 'reference.read');
    assert.equal(references.length, 3);
    assert.deepEqual(references.map(row => row.details.readCount), [1, 2, 3]);
    assert.deepEqual(references[0].details.owningSkillLink, { evidence: 'inferred', skillName: 'checker-a', candidates: ['checker-a'] });
    assert.deepEqual(references[1].details.owningSkillLink, { evidence: 'ambiguous', skillName: '', candidates: ['checker-a', 'checker-b'] });
    assert.deepEqual(references[2].details.owningSkillLink, { evidence: 'ambiguous', skillName: '', candidates: ['checker-a', 'checker-b'] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('genuinely concurrent same-skill invocations across merged agent lanes racing against a tied read report unknown rather than an invented tiebreak', () => {
  const reference = '.github/skills/worker-skill/references/guide.md';
  const root = fixtureAttachment([
    { name: 'worker-skill', references: [{ path: reference }] }
  ]);
  try {
    const { rows } = sessionWaterfall([
      { type: 'subagent.started', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'worker-1', data: { toolCallId: 'delegate-1', agentName: 'fixture-worker' } },
      { type: 'subagent.started', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'worker-2', data: { toolCallId: 'delegate-2', agentName: 'fixture-worker' } },
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:01.000Z', agentId: 'worker-1', data: { name: 'worker-skill', parentToolCallId: 'delegate-1' } },
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:01.000Z', agentId: 'worker-2', data: { name: 'worker-skill', parentToolCallId: 'delegate-2' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', agentId: 'worker-1', data: { toolCallId: 'worker-read', parentToolCallId: 'delegate-1', toolName: 'view', arguments: { path: reference } } }
    ], [], { repoRoot: root });
    const row = rows.find(candidate => candidate.kind === 'reference.read');
    assert.deepEqual(row.details.owningSkillLink, { evidence: 'unknown', skillName: '', candidates: ['worker-skill'] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sessionWaterfall returns a structured per-component-type coverage breakdown additive to existing scalar fields', () => {
  const reference = '.github/skills/build-check/references/guide.md';
  const missingReference = '.github/skills/build-check/references/unread.md';
  const root = fixtureAttachment([
    { name: 'build-check', references: [{ path: reference }, { path: missingReference }] }
  ]);
  try {
    const result = sessionWaterfall([
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.000Z', data: { name: 'build-check' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'read-1', toolName: 'view', arguments: { path: reference } } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'call-undeclared', toolName: 'bash', arguments: { command: 'cat docs/other.md' } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03.000Z', data: { toolCallId: 'call-undeclared', toolName: 'bash', success: true, shellExecution: { exitCode: 0 } } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:04.000Z', data: { toolCallId: 'call-mcp', toolName: 'hindsight-hindsight_search_knowledge_pages', mcpServerName: 'hindsight', mcpToolName: 'hindsight_search_knowledge_pages', arguments: { query: 'fixture' } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:05.000Z', data: { toolCallId: 'orphan-completion', success: true } }
    ], [], { repoRoot: root });
    assert.deepEqual(result.coverage.referenceRead, { observed: 1, missing: 1, unsupported: 1 });
    assert.deepEqual(result.coverage.toolCall, { observed: 4, missing: 3, unsupported: 0 });
    assert.deepEqual(result.coverage.mcp, { observed: 1, missing: null, unsupported: 0 });
    assert.deepEqual(result.coverage.script, { observed: 0, missing: null, unsupported: 0 });
    assert.equal(typeof result.coverageGaps, 'number');
    assert.equal(typeof result.unresolvedRows, 'number');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reference coverage missing count is null, not zero, when no reference manifest was supplied', () => {
  const result = sessionWaterfall([], [], { repoRoot: process.cwd(), referencePaths: new Set(), skillReferences: new Map() });
  assert.equal(result.coverage.referenceRead.missing, null);
});

test('two independent sessionWaterfall calls in the same process never leak reference counts or skill candidates between runs', () => {
  const reference = '.github/skills/build-check/references/guide.md';
  const root = fixtureAttachment([
    { name: 'build-check', references: [{ path: reference }] }
  ]);
  try {
    const sessionA = [
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.000Z', data: { name: 'build-check' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'a-read-1', toolName: 'view', arguments: { path: reference } } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'a-read-2', toolName: 'view', arguments: { path: reference } } }
    ];
    const sessionB = [
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'b-read-1', toolName: 'view', arguments: { path: reference } } }
    ];
    const resultA = sessionWaterfall(sessionA, [], { repoRoot: root });
    const resultB = sessionWaterfall(sessionB, [], { repoRoot: root });
    const referencesA = resultA.rows.filter(row => row.kind === 'reference.read');
    const referencesB = resultB.rows.filter(row => row.kind === 'reference.read');
    assert.deepEqual(referencesA.map(row => row.details.readCount), [1, 2]);
    assert.equal(referencesB.length, 1);
    assert.equal(referencesB[0].details.readCount, 1);
    assert.deepEqual(referencesB[0].details.owningSkillLink, { evidence: 'missing', skillName: '', candidates: [] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('summary surfaces model identity and treats partially-measured tokens as visible unknown, never a silent zero', () => {
  const nativeSpans = [{
    start: Date.parse('2026-01-01T00:00:01.000Z'), end: Date.parse('2026-01-01T00:00:02.000Z'),
    traceId: 'trace-model', spanId: 'span-model', operation: 'chat', agent: 'copilot',
    modelRequested: 'gpt-4', modelActual: 'gpt-4', provider: 'openai',
    inputTokens: 120, outputTokens: null, failed: false
  }];
  const html = renderSessionWaterfall([], 'model-fixture', { nativeSpans });
  assert.match(html, /Model requests/);
  assert.match(html, /gpt-4/);
  assert.match(html, /openai/);
  assert.match(html, />120</);
  assert.match(html, /1\/1 requests measured/);
  assert.match(html, /Unknown/);
  assert.match(html, /0 of 1 requests measured/);
});

test('summary shows model and token metrics as not observed, never as a fabricated zero, when no model-bearing spans exist', () => {
  const html = renderSessionWaterfall([], 'no-model-fixture', {});
  assert.match(html, /Model requests[^<]*·[^<]*not observed in available evidence|not observed in available evidence/);
  assert.doesNotMatch(html, /<strong>0<\/strong>\s*<span>[^<]*[Mm]odel requests/);
  assert.doesNotMatch(html, /<strong>0<\/strong>\s*<span>[^<]*[Ii]nput tokens/);
});

test('summary counts distinct chat requests without adding an aggregate agent span or duplicate delivery', () => {
  const start = Date.parse('2026-01-01T00:00:01.000Z');
  const span = (spanId, operation, inputTokens, outputTokens) => ({
    start, end: start + 1000, traceId: 'trace-usage', spanId, operation,
    agent: 'copilot', modelRequested: 'gpt-4', modelActual: 'gpt-4',
    inputTokens, outputTokens, failed: false
  });
  const html = renderSessionWaterfall([], 'usage-fixture', { nativeSpans: [
    span('parent', 'invoke_agent', 100, 20),
    span('chat-a', 'chat', 60, 12),
    span('chat-b', 'chat', 40, 8),
    span('chat-a', 'chat', 60, 12)
  ] });
  assert.match(html, /<strong>2<\/strong><span>Model requests/);
  assert.match(html, /<strong>100<\/strong><span>Input tokens · 2\/2 requests measured/);
  assert.match(html, /<strong>20<\/strong><span>Output tokens · 2\/2 requests measured/);
  assert.match(html, /<strong>3<\/strong><span>Exact-session native spans/);
});

test('summary labels agent-only token usage as aggregate span evidence', () => {
  const start = Date.parse('2026-01-01T00:00:01.000Z');
  const html = renderSessionWaterfall([], 'agent-aggregate-fixture', { nativeSpans: [{
    start, end: start + 1000, traceId: 'trace-agent', spanId: 'span-agent',
    operation: 'invoke_agent', agent: 'copilot', modelRequested: 'gpt-4',
    inputTokens: 100, outputTokens: null, failed: false
  }] });
  assert.match(html, /Model-bearing spans \(request count unavailable\)/);
  assert.match(html, /Input tokens · 1\/1 spans measured/);
  assert.match(html, /Output tokens — 0 of 1 spans measured/);
});

test('summary reports retries as explicitly not tracked rather than fabricating a zero count', () => {
  const html = renderSessionWaterfall([], 'retry-fixture', {});
  assert.match(html, /Retries/);
  assert.match(html, /Not tracked/);
  assert.match(html, /no retry signal is captured/);
});

test('summary states the effective privacy/capture profile distinctly for metadata-only and full-content modes', () => {
  const metadataHtml = renderSessionWaterfall([], 'privacy-metadata', { metadataOnly: true });
  assert.match(metadataHtml, /Privacy profile/);
  assert.match(metadataHtml, /<strong>Metadata only<\/strong>/);
  const fullHtml = renderSessionWaterfall([], 'privacy-full', { metadataOnly: false });
  assert.match(fullHtml, /Privacy profile/);
  assert.match(fullHtml, /<strong>Full content<\/strong>/);
});

test('undeclared reference reads get a distinct accessible badge so a reviewer cannot mistake them for a declared, sanctioned read', () => {
  const undeclaredPath = 'docs/architecture-notes.md';
  const root = fixtureAttachment([]);
  try {
    const html = renderSessionWaterfall([
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'call-undeclared', toolName: 'bash', arguments: { command: `cat ${undeclaredPath}` } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'call-undeclared', toolName: 'bash', success: true, shellExecution: { exitCode: 0 } } }
    ], 'undeclared-badge', { repoRoot: root });
    assert.match(html, /class="evidence-badge evidence-unsupported"[^>]*>Undeclared/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ambiguous concurrent-ownership reference reads get a distinct accessible badge so they are not mistaken for a confidently-attributed read', () => {
  const reference = '.github/skills/worker-skill/references/guide.md';
  const root = fixtureAttachment([
    { name: 'worker-skill', references: [{ path: reference }] }
  ]);
  try {
    const html = renderSessionWaterfall([
      { type: 'subagent.started', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'worker-1', data: { toolCallId: 'delegate-1', agentName: 'fixture-worker' } },
      { type: 'subagent.started', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'worker-2', data: { toolCallId: 'delegate-2', agentName: 'fixture-worker' } },
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:01.000Z', agentId: 'worker-1', data: { name: 'worker-skill', parentToolCallId: 'delegate-1' } },
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:01.000Z', agentId: 'worker-2', data: { name: 'worker-skill', parentToolCallId: 'delegate-2' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', agentId: 'worker-1', data: { toolCallId: 'worker-read', parentToolCallId: 'delegate-1', toolName: 'view', arguments: { path: reference } } }
    ], 'unknown-badge', { repoRoot: root });
    assert.match(html, /class="evidence-badge evidence-unknown"[^>]*>Ownership unknown/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('coverage by component section renders observed/missing/unsupported, distinguishing not-tracked (null) from a verified zero and from a real gap', () => {
  const reference = '.github/skills/build-check/references/guide.md';
  const missingReference = '.github/skills/build-check/references/unread.md';
  const root = fixtureAttachment([
    { name: 'build-check', references: [{ path: reference }, { path: missingReference }] }
  ]);
  try {
    const html = renderSessionWaterfall([
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.000Z', data: { name: 'build-check' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'read-1', toolName: 'view', arguments: { path: reference } } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:02.000Z', data: { toolCallId: 'call-undeclared', toolName: 'bash', arguments: { command: 'cat docs/other.md' } } },
      { type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:03.000Z', data: { toolCallId: 'call-undeclared', toolName: 'bash', success: true, shellExecution: { exitCode: 0 } } }
    ], 'coverage-fixture', { repoRoot: root });
    assert.match(html, /Coverage by component/);
    assert.match(html, /Not tracked/);
    // script/mcp missing is always null (no declared-manifest concept) -> "Not tracked", never "0".
    assert.doesNotMatch(html, /<dt>Missing<\/dt>\s*<dd[^>]*>0<\/dd>\s*<\/div>\s*<div><dt>Unsupported/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('coverage section shows a verified zero missing distinctly from not-tracked when a manifest is fully satisfied', () => {
  const reference = '.github/skills/build-check/references/guide.md';
  const root = fixtureAttachment([
    { name: 'build-check', references: [{ path: reference }] }
  ]);
  try {
    const html = renderSessionWaterfall([
      { type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.000Z', data: { name: 'build-check' } },
      { type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolCallId: 'read-1', toolName: 'view', arguments: { path: reference } } }
    ], 'coverage-fully-covered', { repoRoot: root });
    assert.match(html, /Reference reads/);
    assert.match(html, /<dt>Missing<\/dt><dd class="">0<\/dd>/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a text search box exists alongside category filters and composes with them without breaking hash deep-linking', () => {
  const nativeSpans = [{ start: Date.parse('2026-01-01T00:00:01.000Z'), end: Date.parse('2026-01-01T00:00:02.000Z'), traceId: 'trace-1', spanId: 'span-1', operation: 'execute_tool', toolName: 'bash', toolCallId: 'call-1', agent: 'copilot', failed: true }];
  const html = renderSessionWaterfall([], 'search-fixture', { nativeSpans });
  assert.match(html, /<input[^>]*id="row-search"[^>]*aria-label="Search[^"]*"/);
  assert.match(html, /data-filter="failed"/);
  assert.match(html, /matchesSearch/);
  assert.match(html, /function showTarget/);
  assert.match(html, /filter\('all'\)/);
});

test('Architecture and Compare navigation is an inert placeholder note, never a fabricated link to nonexistent pages', () => {
  const html = renderSessionWaterfall([], 'nav-placeholder-fixture', {});
  assert.match(html, /Architecture and Compare views/);
  assert.doesNotMatch(html, /<a[^>]*>\s*Architecture[^<]*<\/a>/);
  assert.doesNotMatch(html, /<a[^>]*>\s*Compare[^<]*<\/a>/);
});
