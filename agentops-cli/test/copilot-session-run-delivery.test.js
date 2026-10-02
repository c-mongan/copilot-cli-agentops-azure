const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { deliverCopilotSession } = require('../src/lib/copilot/session-run-delivery');
const { observedLaunchExecutionConfiguration } = require('../src/lib/copilot/execution-configuration');
const { claimSessionOutbox, drainSessionOutboxes, initializeSessionOutbox, readSessionOutbox, releaseSessionOutboxClaim, sessionOutboxPrune, sessionOutboxStatus } = require('../src/lib/copilot/session-delivery-outbox');
const { runDeliveryCommand } = require('../src/lib/delivery-command');
const { projectAgentOpsConfigPath } = require('../src/lib/agentops-config');
const { attachCommand, coverageCommand } = require('../src/lib/attach-command');

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-session-run-delivery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function prepareSession(t, { withSpans = true, configured = true, attached = false } = {}) {
  const root = tempDirectory(t);
  const repo = path.join(root, 'repo');
  const copilotHome = path.join(root, 'copilot-home');
  const agentopsHome = path.join(root, 'agentops-home');
  const collectorHome = path.join(root, 'collector');
  const sessionId = 'session-synthetic';
  childProcess.execFileSync('git', ['init', '-q', repo]);
  if (attached) {
    fs.mkdirSync(path.join(repo, '.github', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'agents', 'reviewer.agent.md'), 'synthetic agent');
    const skill = path.join(repo, '.github', 'skills', 'build-check');
    fs.mkdirSync(path.join(skill, 'references'), { recursive: true });
    fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'synthetic skill');
    fs.writeFileSync(path.join(skill, 'references', 'guide.md'), 'synthetic reference');
    fs.writeFileSync(path.join(skill, 'scripts', 'check.py'), 'print("synthetic")');
  }
  fs.mkdirSync(path.join(copilotHome, 'session-state', sessionId), { recursive: true });
  const sessionEvents = [
    { id: 'start', type: 'session.start', timestamp: '2026-01-01T00:00:00.000Z', data: { sessionId } },
    { id: 'tool', type: 'tool.execution_start', timestamp: '2026-01-01T00:00:01.000Z', data: { toolName: 'bash', toolCallId: 'call-safe', arguments: { command: 'python3 scripts/check.py --secret PRIVATE_COMMAND' } } },
    { id: 'end', type: 'session.shutdown', timestamp: '2026-01-01T00:00:02.000Z', data: { currentModel: 'fixture-model' } }
  ];
  if (attached) {
    sessionEvents.splice(1, 0,
      { id: 'skill', type: 'skill.invoked', timestamp: '2026-01-01T00:00:00.500Z', data: { name: 'build-check', agentDisplayName: 'reviewer' } },
      { id: 'reference', type: 'tool.execution_start', timestamp: '2026-01-01T00:00:00.700Z', data: { toolName: 'read_file', toolCallId: 'call-reference', agentName: 'reviewer', arguments: { path: '.github/skills/build-check/references/guide.md' } } }
    );
  }
  fs.writeFileSync(path.join(copilotHome, 'session-state', sessionId, 'events.jsonl'), sessionEvents.map(event => JSON.stringify(event)).join('\n') + '\n');
  let otelFiles = [];
  if (withSpans) {
    fs.mkdirSync(collectorHome, { recursive: true });
    const file = path.join(collectorHome, 'native-receipt.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({
      type: 'span',
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      startTime: [1767225600, 0],
      endTime: [1767225601, 0],
      name: 'invoke_agent fixture-agent',
      attributes: [{ key: 'gen_ai.conversation.id', value: { stringValue: sessionId } }]
    })}\n`);
    otelFiles = [file];
  }
  let projectConfigPath = '';
  const env = { AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS: '11111111-1111-4111-8111-111111111111' };
  if (configured) {
    projectConfigPath = projectAgentOpsConfigPath({ cwd: repo, agentOpsHome: agentopsHome });
    fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
    fs.writeFileSync(projectConfigPath, JSON.stringify({
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://project.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-project'
    }));
  }
  if (!configured) {
    projectConfigPath = projectAgentOpsConfigPath({ cwd: repo, agentOpsHome: agentopsHome });
    fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
    fs.writeFileSync(projectConfigPath, '{}');
  }
  return { root, repo, copilotHome, agentopsHome, sessionId, otelFiles, projectConfigPath, env };
}

test('delivery rejects a session ID that escapes the Copilot session directory', t => {
  const fixture = prepareSession(t, { configured: false });
  assert.throws(() => deliverCopilotSession({
    summary: { sessionId: '..' }, runId: 'safe-run', copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome, cwd: fixture.repo, upload: false
  }), /safe Copilot session ID/);
});

test('delivery rejects a run ID that resolves to the runs directory', t => {
  const fixture = prepareSession(t, { configured: false });
  assert.throws(() => deliverCopilotSession({
    summary: { sessionId: fixture.sessionId }, runId: '..', copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome, cwd: fixture.repo, upload: false
  }), /safe AgentOps run ID/);
});

test('delivery rejects an event-supplied session ID different from the selected directory', t => {
  const fixture = prepareSession(t, { configured: false });
  const file = path.join(fixture.copilotHome, 'session-state', fixture.sessionId, 'events.jsonl');
  const events = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  events[0].data.sessionId = 'different-session';
  fs.writeFileSync(file, `${events.map(event => JSON.stringify(event)).join('\n')}\n`);
  assert.throws(() => deliverCopilotSession({
    summary: { sessionId: fixture.sessionId }, runId: 'safe-run', copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome, cwd: fixture.repo, upload: false
  }), /does not match selected session/);
});

test('coverage command joins a delivered synthetic run to its exact attached inventory', t => {
  const fixture = prepareSession(t, { attached: true, configured: false });
  attachCommand(['--repo', fixture.repo, '--yes', '--json'], { stdout: { write() {} } });
  const runId = 'wrapper_run_coverage_e2e';
  const otelFile = fixture.otelFiles[0];
  fs.appendFileSync(otelFile, `${JSON.stringify({
    type: 'span', traceId: 'c'.repeat(32), spanId: 'd'.repeat(16),
    startTime: [1767225600, 500000000], endTime: [1767225600, 900000000],
    name: 'agentops.script',
    attributes: [
      { key: 'agentops.run.id', value: { stringValue: runId } },
      { key: 'agentops.script.name', value: { stringValue: '.github/skills/build-check/scripts/check.py' } }
    ]
  })}\n`);
  deliverCopilotSession({
    summary: { sessionId: fixture.sessionId }, runId, copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome, cwd: fixture.repo, env: fixture.env,
    projectConfigPath: fixture.projectConfigPath, otelFiles: fixture.otelFiles,
    spawnSync() { throw new Error('Azure upload must not run in this local coverage test'); }
  });

  const result = coverageCommand(['--repo', fixture.repo, '--json'], {
    agentopsHome: fixture.agentopsHome, stdout: { write() {} }
  });
  assert.equal(result.runtime.associatedRuns, 1);
  assert.equal(result.runtime.executionObserved, true);
  assert.equal(result.runtime.categories.agents.observed, 1);
  assert.equal(result.runtime.categories.skills.observed, 1);
  assert.equal(result.runtime.categories.referenceFiles.observed, 1);
  assert.equal(result.runtime.categories.scriptFiles.observed, 1);
  assert.equal(result.inventoryMatchesAttachment, true);
});

test('coverage reports malformed local evidence instead of treating it as complete', t => {
  const fixture = prepareSession(t, { attached: true, configured: false });
  attachCommand(['--repo', fixture.repo, '--yes', '--json'], { stdout: { write() {} } });
  const runId = 'run-malformed-coverage';
  const delivered = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId }, runId, copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome, cwd: fixture.repo, env: fixture.env,
    projectConfigPath: fixture.projectConfigPath, otelFiles: fixture.otelFiles,
    upload: false
  });
  fs.appendFileSync(path.join(delivered.outputDir, 'AgentOpsEvents_CL.jsonl'), '{bad json\n');
  const result = coverageCommand(['--repo', fixture.repo, '--json'], {
    agentopsHome: fixture.agentopsHome, stdout: { write() {} }
  });
  assert.equal(result.runtime.invalidEvidenceRows, 1);
  assert.equal(result.runtime.evidenceScanComplete, false);
  assert.match(result.runtime.note, /malformed/);
});

test('post-run delivery exports private metadata and uploads both streams to the project DCR', t => {
  const fixture = prepareSession(t);
  const uris = [];
  const result = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId },
    runId: 'wrapper_run_synthetic',
    copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    projectConfigPath: fixture.projectConfigPath,
    otelFiles: fixture.otelFiles,
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
      uris.push(args[args.indexOf('--uri') + 1]);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result.state, 'azure_acknowledged');
  assert.equal(result.events, 3);
  assert.equal(result.spans, 1);
  assert.equal(result.uploads.length, 2);
  assert.ok(uris.every(uri => uri.includes('project.ingest.monitor.azure.com') && uri.includes('dcr-project')));
  assert.ok(uris.some(uri => uri.includes('Custom-AgentOpsEvents_CL')));
  assert.ok(uris.some(uri => uri.includes('Custom-AgentOpsSpans_CL')));
  assert.equal(fs.statSync(path.dirname(result.outputDir)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(result.outputDir).mode & 0o777, 0o700);
  const runContext = JSON.parse(fs.readFileSync(path.join(result.outputDir, 'run-context.json'), 'utf8'));
  assert.equal(runContext.managedBy, 'copilot-agentops');
  assert.equal(runContext.runId, 'wrapper_run_synthetic');
  assert.equal(runContext.sessionId, fixture.sessionId);
  assert.equal(runContext.repositoryRootHash.length, 16);
  assert.equal(runContext.attachmentManifestSha256, '');
  assert.equal(runContext.configurationVersion, null);
  assert.equal(runContext.executionConfigurationHash, null);
  assert.equal(runContext.executionConfiguration.source, 'unknown');
  assert.equal(runContext.executionConfiguration.completeness, 'unknown');
  assert.equal(JSON.stringify(runContext).includes(fixture.repo), false);
  assert.equal(fs.statSync(path.join(result.outputDir, 'run-context.json')).mode & 0o777, 0o600);
  const eventFile = path.join(result.outputDir, 'AgentOpsEvents_CL.jsonl');
  assert.equal(fs.statSync(eventFile).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(eventFile, 'utf8'), /PRIVATE_COMMAND/);
});

test('post-run delivery persists a supplied execution configuration identity and provenance', t => {
  const fixture = prepareSession(t, { configured: false });
  const result = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId },
    runId: 'wrapper_run_configuration_identity',
    copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    projectConfigPath: fixture.projectConfigPath,
    otelFiles: fixture.otelFiles,
    upload: false,
    executionConfiguration: {
      configurationVersion: 'c'.repeat(16),
      completeness: 'authoritative',
      scope: { model: 'authoritative', tools: 'authoritative', mcp: 'authoritative', skills: 'authoritative' }
    }
  });
  const context = JSON.parse(fs.readFileSync(path.join(result.outputDir, 'run-context.json'), 'utf8'));
  assert.equal(context.configurationVersion, 'c'.repeat(16));
  assert.equal(context.executionConfigurationHash, context.configurationVersion);
  assert.equal(context.executionConfiguration.executionConfigurationHash, context.configurationVersion);
  assert.equal(context.executionConfiguration.source, 'supplied_identity');
  assert.equal(context.executionConfiguration.verification, 'caller_asserted');
  assert.equal(context.executionConfiguration.completeness, 'authoritative');
  assert.equal(context.executionConfiguration.observedSettings, null);
});

test('post-run delivery persists only the bounded observed launch projection', t => {
  const fixture = prepareSession(t, { configured: false });
  const result = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId },
    runId: 'wrapper_run_observed_configuration',
    copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    projectConfigPath: fixture.projectConfigPath,
    otelFiles: fixture.otelFiles,
    upload: false,
    executionConfiguration: observedLaunchExecutionConfiguration([
      '--model', 'gpt-5.4-mini', '--allow-tool', 'read_file',
      '--additional-mcp-config', '/private/mcp-config-with-secret.json',
      '--secret-env-vars', 'PRIVATE_TOKEN', '-p', 'PRIVATE_PROMPT'
    ])
  });
  const contextText = fs.readFileSync(path.join(result.outputDir, 'run-context.json'), 'utf8');
  const context = JSON.parse(contextText);
  assert.match(context.configurationVersion, /^[a-f0-9]{16}$/);
  assert.equal(context.executionConfigurationHash, context.configurationVersion);
  assert.equal(context.executionConfiguration.executionConfigurationHash, context.configurationVersion);
  assert.equal(context.executionConfiguration.source, 'observed_launch_arguments');
  assert.equal(context.executionConfiguration.completeness, 'partial');
  assert.equal(context.executionConfiguration.scope.model, 'observed');
  assert.equal(context.executionConfiguration.scope.mcp, 'observed');
  assert.equal(context.executionConfiguration.observedSettings.mcp.additionalConfigCount, 1);
  assert.doesNotMatch(contextText, /PRIVATE_PROMPT|PRIVATE_TOKEN|mcp-config-with-secret|\/private\//);
});

test('native session collection can create coverage evidence locally without uploading', t => {
  const fixture = prepareSession(t, { configured: true, attached: true });
  attachCommand(['--repo', fixture.repo, '--yes', '--json'], { stdout: { write() {} } });
  const runId = 'native_direct_local_collection';
  fs.appendFileSync(fixture.otelFiles[0], `${JSON.stringify({
    type: 'span', traceId: 'c'.repeat(32), spanId: 'd'.repeat(16),
    startTime: [1767225601, 0], endTime: [1767225601, 500000000],
    name: 'agentops.script',
    attributes: [
      { key: 'agentops.run.id', value: { stringValue: runId } },
      { key: 'agentops.script.name', value: { stringValue: '.github/skills/build-check/scripts/check.py' } }
    ]
  })}\n`);
  const result = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId },
    runId,
    copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    projectConfigPath: fixture.projectConfigPath,
    otelFiles: fixture.otelFiles,
    upload: false,
    spawnSync() { throw new Error('local collection must not call Azure CLI'); }
  });

  assert.equal(result.state, 'local_pending');
  assert.equal(result.events, 5);
  assert.equal(result.spans, 2);
  assert.equal(result.uploads.length, 0);
  const runContext = JSON.parse(fs.readFileSync(path.join(result.outputDir, 'run-context.json'), 'utf8'));
  assert.equal(runContext.repositoryRootHash.length, 16);
  assert.ok(runContext.attachmentManifestSha256);
  const coverage = coverageCommand(['--repo', fixture.repo, '--json'], {
    agentopsHome: fixture.agentopsHome,
    stdout: { write() {} }
  });
  assert.equal(coverage.runtime.associatedRuns, 1);
  assert.equal(coverage.runtime.categories.agents.observed, 1);
  assert.equal(coverage.runtime.categories.skills.observed, 1);
  assert.equal(coverage.runtime.categories.referenceFiles.observed, 1);
  assert.equal(coverage.runtime.categories.scriptFiles.observed, 1);
});

test('post-run upload selects only the current run and leaves unrelated session exports pending', t => {
  const fixture = prepareSession(t);
  const target = {
    subscriptionId: '11111111-1111-4111-8111-111111111111',
    logsIngestionEndpoint: 'https://project.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-project'
  };
  const unrelatedRunId = 'wrapper_run_unrelated';
  const unrelatedDir = path.join(fixture.agentopsHome, 'runs', unrelatedRunId);
  fs.mkdirSync(unrelatedDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(unrelatedDir, 'AgentOpsEvents_CL.jsonl'), `${JSON.stringify({
    TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: unrelatedRunId, SessionId: fixture.sessionId,
    EventName: 'session.start', EventId: 'unrelated-event', SchemaVersion: '2'
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(unrelatedDir, 'AgentOpsSpans_CL.jsonl'), `${JSON.stringify({
    TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: unrelatedRunId, SessionId: fixture.sessionId,
    TraceId: 'a'.repeat(32), SpanId: 'b'.repeat(16), SpanName: 'agent.invoke', LinkType: 'exact', Outcome: 'ok', SchemaVersion: '2'
  })}\n`, { mode: 0o600 });
  initializeSessionOutbox(unrelatedDir, { runId: unrelatedRunId, sessionId: fixture.sessionId, cloud: target });

  const uploaded = [];
  const result = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId }, runId: 'wrapper_run_selected',
    copilotHome: fixture.copilotHome, agentopsHome: fixture.agentopsHome, cwd: fixture.repo,
    env: fixture.env, projectConfigPath: fixture.projectConfigPath, otelFiles: fixture.otelFiles,
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: `${target.subscriptionId}\n`, stderr: '' };
      uploaded.push(args[args.indexOf('--uri') + 1]);
      return { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result.state, 'azure_acknowledged');
  assert.equal(result.uploads.length, 2);
  assert.equal(uploaded.length, 2);
  assert.equal(readSessionOutbox(unrelatedDir).streams.events.status, 'pending');
  assert.equal(readSessionOutbox(unrelatedDir).streams.spans.status, 'pending');
});

test('session outbox drain sends only the selected run and leaves other runs pending', t => {
  const fixture = prepareSession(t);
  const target = {
    subscriptionId: '11111111-1111-4111-8111-111111111111',
    logsIngestionEndpoint: 'https://project.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-project'
  };
  const createPendingRun = runId => {
    const outputDir = path.join(fixture.agentopsHome, 'runs', runId);
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(outputDir, 'AgentOpsEvents_CL.jsonl'), `${JSON.stringify({
      TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: runId, SessionId: fixture.sessionId,
      EventName: 'session.start', EventId: `${runId}-event`, SchemaVersion: '2'
    })}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(outputDir, 'AgentOpsSpans_CL.jsonl'), `${JSON.stringify({
      TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: runId, SessionId: fixture.sessionId,
      TraceId: 'a'.repeat(32), SpanId: 'b'.repeat(16), SpanName: 'agent.invoke', LinkType: 'exact', Outcome: 'ok', SchemaVersion: '2'
    })}\n`, { mode: 0o600 });
    initializeSessionOutbox(outputDir, { runId, sessionId: fixture.sessionId, cloud: target });
    return { outputDir };
  };
  const first = createPendingRun('wrapper_run_scope_first');
  const second = createPendingRun('wrapper_run_scope_second');
  assert.equal(sessionOutboxStatus({ agentopsHome: fixture.agentopsHome }).pending, 4);
  const exitedSender = childProcess.spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
  assert.equal(exitedSender.status, 0);
  const secondClaim = path.join(second.outputDir, '.session-delivery.lock');
  fs.writeFileSync(secondClaim, JSON.stringify({ version: 1, pid: exitedSender.pid, nonce: 'stale-run-b-claim' }), { mode: 0o600 });
  const uploaded = [];
  const result = drainSessionOutboxes({
    agentopsHome: fixture.agentopsHome,
    cloud: target,
    runId: 'wrapper_run_scope_first',
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: `${target.subscriptionId}\n`, stderr: '' };
      uploaded.push(args[args.indexOf('--uri') + 1]);
      return { status: 0, stdout: '', stderr: '' };
    },
    env: fixture.env
  });

  assert.equal(result.runId, 'wrapper_run_scope_first');
  assert.equal(result.acknowledged, 2, JSON.stringify(result));
  assert.equal(uploaded.length, 2);
  assert.equal(readSessionOutbox(first.outputDir).streams.events.status, 'azure_accepted');
  assert.equal(readSessionOutbox(first.outputDir).streams.spans.status, 'azure_accepted');
  assert.equal(readSessionOutbox(second.outputDir).streams.events.status, 'pending');
  assert.equal(readSessionOutbox(second.outputDir).streams.spans.status, 'pending');
  assert.equal(fs.existsSync(secondClaim), true, 'a run-scoped drain must not recover another run claim');

  const recoveredOtherRun = drainSessionOutboxes({
    agentopsHome: fixture.agentopsHome,
    cloud: target,
    runId: 'wrapper_run_scope_second',
    env: fixture.env,
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: `${target.subscriptionId}\n`, stderr: '' };
      uploaded.push(args[args.indexOf('--uri') + 1]);
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  assert.equal(recoveredOtherRun.acknowledged, 2);
  assert.equal(uploaded.length, 4);
  assert.equal(fs.existsSync(secondClaim), false);
  assert.equal(readSessionOutbox(second.outputDir).streams.events.status, 'azure_accepted');
  assert.equal(readSessionOutbox(second.outputDir).streams.spans.status, 'azure_accepted');
});

test('post-run delivery preserves local evidence when no project Azure target is configured', t => {
  const fixture = prepareSession(t, { configured: false });
  const result = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId },
    runId: 'wrapper_run_local',
    copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    projectConfigPath: fixture.projectConfigPath,
    otelFiles: fixture.otelFiles,
    spawnSync() { throw new Error('must not attempt an Azure write'); }
  });
  assert.equal(result.state, 'local_pending');
  assert.equal(result.events, 3);
  assert.equal(result.spans, 1);
  assert.match(result.reason, /not fully configured/);
  assert.ok(fs.existsSync(path.join(result.outputDir, 'AgentOpsEvents_CL.jsonl')));
  assert.ok(fs.existsSync(path.join(result.outputDir, 'AgentOpsSpans_CL.jsonl')));
});

test('post-run delivery does not claim a complete upload if one evidence stream is missing', t => {
  const fixture = prepareSession(t, { withSpans: false });
  const result = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId },
    runId: 'wrapper_run_missing_spans',
    copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    projectConfigPath: fixture.projectConfigPath,
    otelFiles: [],
    spawnSync(_command, args) {
      return args[0] === 'account'
        ? { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' }
        : { status: 0, stdout: '', stderr: '' };
    }
  });
  assert.equal(result.state, 'local_pending');
  assert.equal(result.events, 3);
  assert.equal(result.spans, 0);
  assert.match(result.reason, /not observed/);
  assert.equal(result.streams.events.status, 'azure_accepted');
  assert.equal(result.streams.spans.status, 'not_observed');
});

test('post-run delivery reports partial Azure acceptance and drain retries only the pending stream', async t => {
  const fixture = prepareSession(t);
  const result = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId },
    runId: 'wrapper_run_partial_upload',
    copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    projectConfigPath: fixture.projectConfigPath,
    otelFiles: fixture.otelFiles,
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
      const uri = args[args.indexOf('--uri') + 1];
      return uri.includes('Custom-AgentOpsSpans_CL')
        ? { status: 1, stdout: '', stderr: 'synthetic DCR rejection' }
        : { status: 0, stdout: '', stderr: '' };
    }
  });

  assert.equal(result.state, 'local_pending');
  assert.equal(result.streams.events.status, 'azure_accepted');
  assert.equal(result.streams.spans.status, 'local_pending');
  assert.equal(result.uploads.length, 2);
  assert.ok(fs.existsSync(path.join(result.outputDir, 'AgentOpsEvents_CL.jsonl')));
  assert.ok(fs.existsSync(path.join(result.outputDir, 'AgentOpsSpans_CL.jsonl')));
  const outbox = readSessionOutbox(result.outputDir);
  assert.equal(outbox.streams.events.status, 'azure_accepted');
  assert.equal(outbox.streams.spans.status, 'pending');
  assert.equal(outbox.streams.events.attempts, 1);
  assert.equal(outbox.streams.spans.attempts, 1);

  const otherRunId = 'wrapper_run_partial_other';
  const otherRunDirectory = path.join(fixture.agentopsHome, 'runs', otherRunId);
  fs.mkdirSync(otherRunDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(otherRunDirectory, 'AgentOpsEvents_CL.jsonl'), `${JSON.stringify({
    TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: otherRunId, SessionId: fixture.sessionId,
    EventName: 'session.start', EventId: `${otherRunId}-event`, SchemaVersion: '2'
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(otherRunDirectory, 'AgentOpsSpans_CL.jsonl'), `${JSON.stringify({
    TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: otherRunId, SessionId: fixture.sessionId,
    TraceId: 'c'.repeat(32), SpanId: 'd'.repeat(16), SpanName: 'other.agent.invoke', LinkType: 'exact', Outcome: 'ok', SchemaVersion: '2'
  })}\n`, { mode: 0o600 });
  initializeSessionOutbox(otherRunDirectory, {
    runId: otherRunId,
    sessionId: fixture.sessionId,
    cloud: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://project.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-project'
    }
  });

  const retriedUris = [];
  const recovered = await runDeliveryCommand(['drain', '--yes', '--run-id', 'wrapper_run_partial_upload'], {
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    config: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://project.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-project'
    },
    createDelivery() {
      return {
        status: () => ({ pending: 0 }),
        async drain() { return { ok: true, configured: true, state: 'azure_acknowledged', result: { acknowledged: 0, status: { pending: 0 } } }; }
      };
    },
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
      retriedUris.push(args[args.indexOf('--uri') + 1]);
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  assert.equal(recovered.sessions.acknowledged, 1);
  assert.equal(recovered.sessions.pending, 0);
  assert.equal(recovered.state, 'azure_acknowledged');
  assert.equal(retriedUris.length, 1);
  assert.ok(retriedUris[0].includes('Custom-AgentOpsSpans_CL'));
  const recoveredOutbox = readSessionOutbox(result.outputDir);
  assert.equal(recoveredOutbox.streams.events.attempts, 1);
  assert.equal(recoveredOutbox.streams.spans.attempts, 2);
  assert.equal(recoveredOutbox.streams.spans.status, 'azure_accepted');
  assert.equal(readSessionOutbox(otherRunDirectory).streams.events.status, 'pending');
  assert.equal(readSessionOutbox(otherRunDirectory).streams.spans.status, 'pending');

  const secondDrain = await runDeliveryCommand(['drain', '--yes', '--run-id', 'wrapper_run_partial_upload'], {
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    config: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://project.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-project'
    },
    createDelivery() {
      return {
        status: () => ({ pending: 0 }),
        async drain() { return { ok: true, configured: true, state: 'local_pending', result: { acknowledged: 0, status: { pending: 0 } } }; }
      };
    },
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
      throw new Error('accepted session batches must not be resent');
    }
  });
  assert.equal(secondDrain.sessions.streams.length, 0);
  assert.equal(secondDrain.state, 'azure_acknowledged');
  assert.equal(sessionOutboxStatus({ agentopsHome: fixture.agentopsHome }).pending, 2);
});

test('post-run delivery refuses a symlinked runs directory', t => {
  const fixture = prepareSession(t, { configured: false });
  const outside = path.join(fixture.root, 'outside');
  fs.mkdirSync(outside);
  fs.mkdirSync(fixture.agentopsHome, { recursive: true });
  fs.symlinkSync(outside, path.join(fixture.agentopsHome, 'runs'));

  assert.throws(() => deliverCopilotSession({
    summary: { sessionId: fixture.sessionId },
    runId: 'wrapper_run_symlink',
    copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    projectConfigPath: fixture.projectConfigPath,
    otelFiles: fixture.otelFiles
  }), /must be a real directory/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('session outbox never sends a pending run to a different Azure target', t => {
  const fixture = prepareSession(t, { configured: false });
  const runs = path.join(fixture.agentopsHome, 'runs');
  const runDirectory = path.join(runs, 'wrapper_run_bound_target');
  fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(runDirectory, 'AgentOpsEvents_CL.jsonl'), '{"RunId":"wrapper_run_bound_target"}\n', { mode: 0o600 });
  fs.writeFileSync(path.join(runDirectory, 'AgentOpsSpans_CL.jsonl'), '{"RunId":"wrapper_run_bound_target"}\n', { mode: 0o600 });
  initializeSessionOutbox(runDirectory, {
    runId: 'wrapper_run_bound_target',
    sessionId: fixture.sessionId,
    cloud: {
      subscriptionId: '11111111-1111-4111-8111-111111111111',
      logsIngestionEndpoint: 'https://original.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-original'
    }
  });
  let writes = 0;
  const result = drainSessionOutboxes({
    agentopsHome: fixture.agentopsHome,
    cloud: {
      subscriptionId: '22222222-2222-4222-8222-222222222222',
      logsIngestionEndpoint: 'https://other.ingest.monitor.azure.com',
      dcrImmutableId: 'dcr-other'
    },
    spawnSync() { writes += 1; throw new Error('must not write to a different Azure target'); }
  });
  assert.equal(writes, 0);
  assert.equal(result.skippedTarget, 2);
  assert.equal(result.pending, 2);
  assert.equal(sessionOutboxStatus({ agentopsHome: fixture.agentopsHome }).pending, 2);
});

test('session outbox skips a live drain claim and recovers a claim from an exited process', t => {
  const fixture = prepareSession(t);
  const result = deliverCopilotSession({
    summary: { sessionId: fixture.sessionId },
    runId: 'wrapper_run_claim_recovery',
    copilotHome: fixture.copilotHome,
    agentopsHome: fixture.agentopsHome,
    cwd: fixture.repo,
    env: fixture.env,
    projectConfigPath: fixture.projectConfigPath,
    otelFiles: fixture.otelFiles,
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
      return { status: 1, stdout: '', stderr: 'synthetic offline endpoint' };
    }
  });
  assert.equal(result.state, 'local_pending');
  const claimFile = path.join(result.outputDir, '.session-delivery.lock');
  const target = {
    subscriptionId: '11111111-1111-4111-8111-111111111111',
    logsIngestionEndpoint: 'https://project.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-project'
  };

  fs.writeFileSync(claimFile, JSON.stringify({ version: 1, pid: process.pid }), { mode: 0o600 });
  let writes = 0;
  const busy = drainSessionOutboxes({
    agentopsHome: fixture.agentopsHome,
    cloud: target,
    spawnSync() { writes += 1; throw new Error('a live claim must block another sender'); }
  });
  assert.equal(writes, 0);
  assert.equal(busy.skippedBusy, 2);
  assert.equal(busy.pending, 2);

  const child = childProcess.spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  fs.writeFileSync(claimFile, JSON.stringify({ version: 1, pid: Number(child.stdout) }), { mode: 0o600 });
  const recovered = drainSessionOutboxes({
    agentopsHome: fixture.agentopsHome,
    cloud: target,
    env: fixture.env,
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\n', stderr: '' };
      writes += 1;
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  assert.equal(recovered.acknowledged, 2);
  assert.equal(recovered.pending, 0);
  assert.equal(writes, 2);
  assert.equal(fs.existsSync(claimFile), false);
  const state = readSessionOutbox(result.outputDir);
  assert.equal(state.streams.events.status, 'azure_accepted');
  assert.equal(state.streams.spans.status, 'azure_accepted');
});

test('session outbox pruning previews terminal runs and preserves pending or mixed-content directories', t => {
  const root = tempDirectory(t);
  const agentopsHome = path.join(root, 'agentops-home');
  const runs = path.join(agentopsHome, 'runs');
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const createRun = (runId, status = 'azure_accepted') => {
    const directory = path.join(runs, runId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(directory, 'AgentOpsEvents_CL.jsonl'), '{"EventName":"synthetic"}\n', { mode: 0o600 });
    initializeSessionOutbox(directory, { runId, sessionId: 'session-retention' });
    const state = readSessionOutbox(directory);
    state.updatedAt = old;
    state.streams.events.status = status;
    state.streams.spans.status = 'not_observed';
    fs.writeFileSync(path.join(directory, 'session-delivery.json'), JSON.stringify(state), { mode: 0o600 });
    return directory;
  };
  const accepted = createRun('wrapper_run_expired_accepted');
  const pending = createRun('wrapper_run_old_pending', 'pending');
  const active = createRun('wrapper_run_active_drain');
  const mixed = createRun('wrapper_run_with_extra_file');
  fs.writeFileSync(path.join(active, '.session-delivery.lock'), JSON.stringify({ pid: process.pid, nonce: 'active-test' }), { mode: 0o600 });
  fs.writeFileSync(path.join(mixed, 'user-owned.txt'), 'preserve me');

  assert.throws(() => sessionOutboxPrune({ agentopsHome, olderThanDays: 29 }), /30 to 365 days/);
  const preview = sessionOutboxPrune({ agentopsHome, olderThanDays: 30 });
  assert.ok(preview.candidates.some(item => item.run_id === 'wrapper_run_expired_accepted'), JSON.stringify({ agentopsHome, preview }));
  assert.deepEqual(preview.candidates.map(item => item.run_id), ['wrapper_run_expired_accepted'], JSON.stringify(preview));
  assert.ok(preview.skipped.some(item => item.run_id === 'wrapper_run_old_pending' && item.reason === 'delivery_not_complete'));
  assert.ok(preview.skipped.some(item => item.run_id === 'wrapper_run_active_drain' && item.reason === 'active_drain'));
  assert.ok(preview.skipped.some(item => item.run_id === 'wrapper_run_with_extra_file' && item.reason === 'unrecognized_files_present'));
  assert.equal(fs.existsSync(path.join(accepted, 'AgentOpsEvents_CL.jsonl')), true);

  const applied = sessionOutboxPrune({ agentopsHome, olderThanDays: 30, apply: true });
  assert.deepEqual(applied.removed.map(item => item.run_id), ['wrapper_run_expired_accepted']);
  assert.equal(fs.existsSync(accepted), false);
  assert.equal(fs.existsSync(pending), true);
  assert.equal(fs.existsSync(path.join(active, 'session-delivery.json')), true);
  assert.equal(fs.readFileSync(path.join(mixed, 'user-owned.txt'), 'utf8'), 'preserve me');
  assert.equal(fs.existsSync(path.join(mixed, 'session-delivery.json')), true);
});

test('session outbox claims are exclusive across processes', async t => {
  const root = tempDirectory(t);
  const runDirectory = path.join(root, 'runs', 'wrapper_run_process_lock');
  fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  const startFile = path.join(root, 'start-claim-race');
  const modulePath = path.resolve(__dirname, '../src/lib/copilot/session-delivery-outbox.js');
  const childScript = `
    const fs = require('node:fs');
    const { setTimeout: delay } = require('node:timers/promises');
    const api = require(${JSON.stringify(modulePath)});
    (async () => {
      while (!fs.existsSync(process.env.AGENTOPS_TEST_START_FILE)) await delay(1);
      const claim = api.claimSessionOutbox(process.env.AGENTOPS_TEST_RUN_DIRECTORY);
      process.stdout.write(JSON.stringify({ acquired: claim.acquired, ownerPid: claim.ownerPid }) + '\\n');
      if (claim.acquired) {
        await delay(200);
        api.releaseSessionOutboxClaim(claim);
      }
    })().catch(error => { process.stderr.write(error.stack || error.message); process.exitCode = 1; });
  `;
  const claimants = [1, 2].map(() => {
    const child = childProcess.spawn(process.execPath, ['-e', childScript], {
      env: {
        ...process.env,
        AGENTOPS_TEST_RUN_DIRECTORY: runDirectory,
        AGENTOPS_TEST_START_FILE: startFile
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('timed out waiting for competing outbox claimants'));
      }, 3000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', code => {
        clearTimeout(timeout);
        if (code !== 0) return reject(new Error(`claiming child exited with ${code}: ${stderr}`));
        try { resolve(JSON.parse(stdout.trim())); } catch (error) { reject(new Error(`invalid claimant output: ${error.message}`)); }
      });
    });
  });
  fs.writeFileSync(startFile, 'start\n');
  const outcomes = await Promise.all(claimants);
  assert.equal(outcomes.filter(outcome => outcome.acquired).length, 1);
  assert.equal(outcomes.filter(outcome => !outcome.acquired).length, 1);
  assert.equal(fs.existsSync(path.join(runDirectory, '.session-delivery.lock')), false);
  const afterExit = claimSessionOutbox(runDirectory);
  assert.equal(afterExit.acquired, true);
  releaseSessionOutboxClaim(afterExit);
});

test('session outbox recovers an in-flight stream after process exit and documents at-least-once retry', t => {
  const fixture = prepareSession(t, { configured: false });
  const runId = 'wrapper_run_crash_after_acceptance';
  const runDirectory = path.join(fixture.agentopsHome, 'runs', runId);
  const marker = path.join(fixture.root, 'simulated-azure-acceptance.txt');
  fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(runDirectory, 'AgentOpsEvents_CL.jsonl'), `${JSON.stringify({
    TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: runId, SessionId: fixture.sessionId,
    EventName: 'synthetic.event', EventId: 'synthetic-event'
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(runDirectory, 'AgentOpsSpans_CL.jsonl'), `${JSON.stringify({
    TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: runId, SessionId: fixture.sessionId,
    TraceId: 'a'.repeat(32), SpanId: 'b'.repeat(16), SpanName: 'synthetic-span', LinkType: 'exact', Outcome: 'ok'
  })}\n`, { mode: 0o600 });
  const cloud = {
    subscriptionId: '11111111-1111-4111-8111-111111111111',
    logsIngestionEndpoint: 'https://project.ingest.monitor.azure.com',
    dcrImmutableId: 'dcr-project'
  };
  initializeSessionOutbox(runDirectory, { runId, sessionId: fixture.sessionId, cloud });

  // A crashed run must not make recovery upload another run's still-pending
  // evidence. Keep a second run in the same AgentOps home to exercise the
  // actual multi-run drain boundary, not only a single-run happy path.
  const otherRunId = 'wrapper_run_recovery_isolation';
  const otherRunDirectory = path.join(fixture.agentopsHome, 'runs', otherRunId);
  fs.mkdirSync(otherRunDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(otherRunDirectory, 'AgentOpsEvents_CL.jsonl'), `${JSON.stringify({
    TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: otherRunId, SessionId: fixture.sessionId,
    EventName: 'synthetic.other-run', EventId: 'synthetic-other-event'
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(otherRunDirectory, 'AgentOpsSpans_CL.jsonl'), `${JSON.stringify({
    TimeGenerated: '2026-01-01T00:00:00.000Z', RunId: otherRunId, SessionId: fixture.sessionId,
    TraceId: 'c'.repeat(32), SpanId: 'd'.repeat(16), SpanName: 'synthetic-other-span', LinkType: 'exact', Outcome: 'ok'
  })}\n`, { mode: 0o600 });
  initializeSessionOutbox(otherRunDirectory, { runId: otherRunId, sessionId: fixture.sessionId, cloud });

  const modulePath = path.resolve(__dirname, '../src/lib/copilot/session-delivery-outbox.js');
  const childScript = `
    const fs = require('node:fs');
    const api = require(${JSON.stringify(modulePath)});
    api.drainSessionOutboxes({
      agentopsHome: process.env.AGENTOPS_TEST_HOME,
      runId: process.env.AGENTOPS_TEST_RUN_ID,
      cloud: JSON.parse(process.env.AGENTOPS_TEST_CLOUD),
      spawnSync(_command, args) {
        if (args[0] === 'account') return { status: 0, stdout: '11111111-1111-4111-8111-111111111111\\n', stderr: '' };
        fs.appendFileSync(process.env.AGENTOPS_TEST_MARKER, 'accepted\\n');
        process.exit(0); // Simulate Azure accepting Events before local checkpoint persistence.
      }
    });
  `;
  const crashed = childProcess.spawnSync(process.execPath, ['-e', childScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...fixture.env,
      AGENTOPS_TEST_HOME: fixture.agentopsHome,
      AGENTOPS_TEST_RUN_ID: runId,
      AGENTOPS_TEST_CLOUD: JSON.stringify(cloud),
      AGENTOPS_TEST_MARKER: marker
    }
  });
  assert.equal(crashed.status, 0, crashed.stderr);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'accepted\n');
  const interrupted = readSessionOutbox(runDirectory);
  assert.equal(interrupted.streams.events.status, 'in_flight');
  assert.equal(interrupted.streams.events.attempts, 1);
  assert.equal(interrupted.streams.spans.status, 'pending');

  const retried = [];
  const recovered = drainSessionOutboxes({
    agentopsHome: fixture.agentopsHome,
    runId,
    cloud,
    env: fixture.env,
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: `${cloud.subscriptionId}\n`, stderr: '' };
      retried.push(args[args.indexOf('--uri') + 1]);
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  assert.equal(recovered.acknowledged, 2);
  assert.equal(recovered.pending, 0);
  assert.equal(retried.length, 2);
  assert.ok(retried[0].includes('AgentOpsEvents_CL'));
  assert.ok(retried[1].includes('AgentOpsSpans_CL'));
  const delivered = readSessionOutbox(runDirectory);
  assert.equal(delivered.streams.events.status, 'azure_accepted');
  assert.equal(delivered.streams.events.attempts, 2);
  assert.equal(delivered.streams.spans.status, 'azure_accepted');
  assert.equal(delivered.streams.spans.attempts, 1);
  const untouched = readSessionOutbox(otherRunDirectory);
  assert.equal(untouched.streams.events.status, 'pending');
  assert.equal(untouched.streams.spans.status, 'pending');
  assert.equal(untouched.streams.events.attempts, 0);

  const otherRunDrain = drainSessionOutboxes({
    agentopsHome: fixture.agentopsHome,
    cloud,
    env: fixture.env,
    runId: otherRunId,
    spawnSync(_command, args) {
      if (args[0] === 'account') return { status: 0, stdout: `${cloud.subscriptionId}\n`, stderr: '' };
      retried.push(args[args.indexOf('--uri') + 1]);
      return { status: 0, stdout: '', stderr: '' };
    }
  });
  assert.equal(otherRunDrain.acknowledged, 2);
  assert.equal(retried.length, 4);
  const recoveredOtherRun = readSessionOutbox(otherRunDirectory);
  assert.equal(recoveredOtherRun.streams.events.status, 'azure_accepted');
  assert.equal(recoveredOtherRun.streams.spans.status, 'azure_accepted');
});
