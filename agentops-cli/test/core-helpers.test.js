const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  defaultSessionEventsPath,
  enrichCopilotSessionEvents,
  inferMcpServer,
  inferMcpTool,
  readCopilotSessionEvents,
  safeName,
  toolRisk
} = require('../src/lib/copilot/session-enricher');
const {
  exampleAgentRunAttributes,
  validateAgentRun,
  validateMcpSpan
} = require('../src/lib/schema/agent-run-schema');
const {
  explainFromFiles,
  explainRun,
  latestByTime,
  renderV2Explanation
} = require('../src/lib/explain/v2-explain');
const {
  envLooksSecret,
  poisonCheck,
  redactedEnvSummary,
  sanitizeAttributesStrict
} = require('../src/lib/privacy');
const {
  validatePoisonFixture,
  validateProcessorFragment
} = require('../src/lib/collector-artifacts');
const shell = require('../src/lib/shell');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-core-helpers-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

test('copilot session paths reject unsafe session ids and preserve safe ids', () => {
  assert.equal(safeName(' agent-01_./:@* '), 'agent-01_./:@*');
  assert.equal(safeName('../bad session', 'fallback'), 'fallback');
  assert.throws(
    () => defaultSessionEventsPath('../bad session', '/tmp/home'),
    /session id is required/
  );
  assert.equal(
    defaultSessionEventsPath('session_123', '/tmp/home'),
    path.join('/tmp/home', '.copilot', 'session-state', 'session_123', 'events.jsonl')
  );
});

test('copilot session reader parses jsonl and surfaces invalid file/json paths', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'events.jsonl');
    writeJsonl(file, [{ type: 'skill.invoked', data: { name: 'review' } }]);
    assert.deepEqual(readCopilotSessionEvents(file), [
      { type: 'skill.invoked', data: { name: 'review' } }
    ]);

    assert.throws(() => readCopilotSessionEvents(path.join(dir, 'missing.jsonl')), /ENOENT/);
    fs.writeFileSync(file, '{"type":');
    assert.throws(() => readCopilotSessionEvents(file), /JSON/);
  });
});

test('copilot MCP inference covers explicit, Azure, mcp namespace, and slash forms', () => {
  assert.equal(inferMcpServer({ mcp_server_name: 'github' }), 'github');
  assert.equal(inferMcpTool({ mcp_tool_name: 'search_issues' }), 'search_issues');

  assert.equal(inferMcpServer({ name: 'azure-mcp-list-subscriptions' }), 'azure-mcp');
  assert.equal(inferMcpTool({ name: 'azure-mcp-list-subscriptions' }), 'list-subscriptions');

  assert.equal(inferMcpServer({ name: 'mcp__posthog__query-events' }), 'posthog');
  assert.equal(inferMcpTool({ name: 'mcp__posthog__query-events' }), 'query-events');

  assert.equal(inferMcpServer({ name: 'browser/click' }), 'browser');
  assert.equal(inferMcpTool({ name: 'browser/click' }), 'click');
  assert.equal(inferMcpServer({ name: 'bad tool name' }), '');
});

test('copilot session enrichment emits MCP metadata, skill requests, and failed tools', () => {
  const rows = enrichCopilotSessionEvents([
    { type: 'subagent.selected', data: { agentDisplayName: 'agent one', tools: ['bash'] } },
    { type: 'assistant.message', data: { toolRequests: [
      { name: 'skill', arguments: { skill: 'code-review' } },
      { name: 'mcp__github__delete_branch' },
      { name: 'bash' }
    ] } },
    { type: 'tool.execution_complete', data: { toolName: 'bash', success: false } },
    { type: 'hook.start', data: { hookType: 'pre-commit' } }
  ], { sessionId: 's1', agent: 'seed-agent' });

  assert.equal(rows[0].agent, 'seed-agent');
  assert.equal(rows[0].attributes['agentops.agent.name'], 'seed-agent');
  assert.equal(rows[1].event, 'skill.requested');
  assert.equal(rows[2].event, 'mcp.tools.call');
  assert.equal(rows[2].attributes['agentops.mcp.server'], 'github');
  assert.equal(rows[2].attributes['agentops.mcp.tool'], 'delete_branch');
  assert.equal(rows[2].attributes['agentops.mcp.tool.risk'], 'destructive');
  assert.equal(rows[3].attributes['gen_ai.tool.type'], 'builtin');
  assert.equal(rows[4].outcome, 'failed');
  assert.equal(rows[4].attributes['error.type'], 'tool_failed');
  assert.equal(rows[5].event, 'hook.started');
});

test('tool risk classifies edge cases without content capture', () => {
  assert.equal(toolRisk('write_file'), 'write-file');
  assert.equal(toolRisk('get_secret'), 'secret-access');
  assert.equal(toolRisk('browser_click'), 'browser-control');
  assert.equal(toolRisk('shell_exec'), 'shell');
  assert.equal(toolRisk('list', 'github'), 'read-only');
  assert.equal(toolRisk('list'), 'unknown');
});

test('agent run schema flags invalid enums, content, versions, and missing MCP paths', () => {
  const valid = exampleAgentRunAttributes();
  assert.equal(validateAgentRun(valid).ok, true);

  const invalid = validateAgentRun({
    attributes: {
      ...valid,
      'agentops.privacy.mode': 'loud',
      'agentops.content_capture.mode': 'on',
      'agentops.schema.version': '0.0.0',
      'gen_ai.prompt': 'do not export this'
    }
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /agentops\.privacy\.mode=loud/);
  assert.match(invalid.warnings.join('\n'), /schema version is 0\.0\.0/);

  const contentInvalid = validateAgentRun({
    attributes: {
      ...valid,
      'gen_ai.prompt': 'do not export this'
    }
  });
  assert.equal(contentInvalid.ok, false);
  assert.match(contentInvalid.errors.join('\n'), /strict privacy mode must not export content attribute: gen_ai\.prompt/);

  const mcp = validateMcpSpan({
    'agentops.mcp.server': 'github',
    'gen_ai.operation.name': 'chat'
  });
  assert.equal(mcp.ok, false);
  assert.match(mcp.errors.join('\n'), /missing required MCP attribute/);
  assert.match(mcp.errors.join('\n'), /execute_tool/);
});

test('explain helpers pick latest runs and handle missing or invalid file inputs', () => {
  const missing = explainRun(null);
  assert.equal(missing.ok, false);
  assert.equal(renderV2Explanation(missing), [
    'AgentOps explanation',
    '',
    'Not enough data yet',
    'No V2 AgentOps run rows were available.',
    ''
  ].join('\n'));

  const older = { RunId: 'old', TimeGenerated: '2026-01-01T00:00:00Z', OutcomeStatus: 'success' };
  const newer = { RunId: 'new', TimeGenerated: '2026-01-02T00:00:00Z', OutcomeStatus: 'failed', OutcomeReason: 'tool failed' };
  assert.equal(latestByTime([older, newer]).RunId, 'new');

  withTempDir((dir) => {
    const runsFile = path.join(dir, 'runs.jsonl');
    const evalsFile = path.join(dir, 'evals.jsonl');
    const insightsFile = path.join(dir, 'insights.jsonl');
    writeJsonl(runsFile, [older, newer]);
    writeJsonl(evalsFile, [{ RunId: 'new', EvalOverall: 55, EvalBucket: 'weak', EvalReason: 'low score' }]);
    writeJsonl(insightsFile, [{ RunId: 'new', Severity: 'high', InsightType: 'failure', Summary: 'High risk', SuggestedNextStep: 'Fix it' }]);

    const latest = explainFromFiles({ runsFile, evalsFile, insightsFile, runId: 'latest' });
    assert.equal(latest.run.RunId, 'new');
    assert.equal(latest.headline, 'High risk');
    assert.match(renderV2Explanation(latest), /Insights:\n- high: failure - High risk/);

    const old = explainFromFiles({ runsFile, evalsFile, insightsFile, runId: 'old' });
    assert.equal(old.run.RunId, 'old');
    assert.equal(old.evaluation, null);

    assert.throws(
      () => explainFromFiles({ runsFile: path.join(dir, 'missing.jsonl'), evalsFile, insightsFile }),
      /ENOENT/
    );
  });
});

test('privacy helpers redact secret-like env values and drop unsafe content attributes', () => {
  const summary = redactedEnvSummary({
    AGENTOPS_ENDPOINT: 'https://collector.example',
    AZURE_CLIENT_SECRET: 'secret-value',
    GITHUB_TOKEN: 'token-value',
    OPENAI_API_KEY: 'key-value',
    HOME: '/Users/example'
  });

  assert.deepEqual(summary, {
    AGENTOPS_ENDPOINT: 'https://collector.example',
    AZURE_CLIENT_SECRET: '[REDACTED]',
    GITHUB_TOKEN: '[REDACTED]',
    OPENAI_API_KEY: '[REDACTED]'
  });
  assert.equal(envLooksSecret('APPLICATIONINSIGHTS_CONNECTION_STRING'), true);
  assert.equal(envLooksSecret('AGENTOPS_ENDPOINT'), false);

  const sanitized = sanitizeAttributesStrict({
    'agentops.run.id': 'run-1',
    'gen_ai.operation.name': 'chat',
    'gen_ai.prompt': 'secret prompt',
    'code.filepath': '/private/file.js',
    'unknown.future.content.field': 'secret content'
  });
  assert.deepEqual(sanitized, {
    'agentops.run.id': 'run-1',
    'gen_ai.operation.name': 'chat',
    'agentops.content_capture.signal': true
  });
  assert.equal(poisonCheck().ok, true);
});

test('collector artifact helpers validate processor fragments and poison fixtures', () => {
  assert.equal(validateProcessorFragment({
    file: 'strict-allowlist.yaml',
    body: 'processors:\n  transform/privacy_strict:\n    keep_keys: []\n'
  }), null);
  assert.match(validateProcessorFragment({
    file: 'content-signal.yaml',
    body: 'processors: {}\n'
  }), /missing content capture signal/);

  withTempDir((dir) => {
    const fixture = path.join(dir, 'content-poison.json');
    fs.writeFileSync(fixture, JSON.stringify({
      prompt: 'this should never leave local machine',
      token: 'SECRET_FAKE_TEST_VALUE',
      'gen_ai.operation.name': 'chat'
    }));

    const result = validatePoisonFixture({ file: 'content-poison.json', fullPath: fixture });
    assert.equal(result.ok, true);
    assert.equal(result.content_signal, true);
    assert.deepEqual(result.leaked, []);
  });
});

test('shell helpers find candidates, check executability, and merge env for local commands', () => {
  withTempDir((dir) => {
    const binA = path.join(dir, 'a');
    const binB = path.join(dir, 'b');
    fs.mkdirSync(binA);
    fs.mkdirSync(binB);
    fs.writeFileSync(path.join(binA, 'demo'), '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(path.join(binB, 'demo'), '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(path.join(binA, 'demo.CMD'), '');

    assert.deepEqual(shell.commandCandidates('demo', {
      pathValue: [binA, binB].join(path.delimiter),
      platform: 'linux'
    }), [path.join(binA, 'demo'), path.join(binB, 'demo')]);
    assert.equal(shell.commandExists('missing', { pathValue: binA, platform: 'linux' }), false);

    const windowsCandidates = shell.commandCandidates('demo', {
      pathValue: binA,
      platform: 'win32'
    });
    assert.ok(windowsCandidates.includes(path.join(binA, 'demo.cmd')));

    const executable = path.join(binA, 'executable');
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(executable, 0o755);
    assert.equal(shell.isExecutable(executable), true);
    assert.equal(shell.isExecutable(path.join(binA, 'demo.CMD')), false);
    assert.equal(shell.isExecutable(path.join(binA, 'missing')), false);
  });

  const result = shell.run(process.execPath, ['-e', 'process.stdout.write(process.env.AGENTOPS_TEST_VALUE)'], {
    env: { AGENTOPS_TEST_VALUE: 'merged' }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'merged');
});
