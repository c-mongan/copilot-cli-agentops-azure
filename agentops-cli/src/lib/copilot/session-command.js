const { capturePreRunSnapshot } = require('./run-evidence-contract');
const { loadComponentExpectations } = require('./component-evidence');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const legacy = require('../../legacy');
const { optionValue, optionValues, parseJsonFlag } = require('../args');
const { otlpHttpEndpoint } = require('../collector-endpoints');
const { writeJsonlFile, writeJsonOrRender } = require('../command-output');
const { agentopsHome, repoRoot: agentopsRoot } = require('../paths');
const { configuredCloudValues, projectAgentOpsConfigPath } = require('../agentops-config');
const { resolveCopilotBinary } = require('../copilot-resolver');
const { attachedScriptEnvironment } = require('./script-observation');
const { startScopedStrictCollector } = require('./scoped-collector');
const { superviseProcess } = require('./process-supervisor');
const { changedCopilotSession, snapshotCopilotSessions } = require('./receipt-session');
const { deliverCopilotSession } = require('./session-run-delivery');
const { observedLaunchExecutionConfiguration } = require('./execution-configuration');
const {
  defaultSessionEventsPath,
  enrichCopilotSessionEvents,
  readScriptSidecarEvents,
  readCopilotSessionEvents
} = require('./session-enricher');
const { writeSessionWaterfall } = require('./session-waterfall');
const { defaultReceiptFiles, readSessionOtelSpans } = require('./session-otel');
const { enrichSpansWithSessionToolContext, readSessionSpanRows, writeSessionSpans } = require('./session-span-export');
const { deleteSessionContent, writeSessionContent } = require('./session-content');
const { writeSessionEvents } = require('./session-event-export');
const { readSessionOutbox } = require('./session-delivery-outbox');
const { exportSessionGenAi, renderGenAiExport } = require('./session-genai-export');

function parseCopilotSessionArgs(args = []) {
  const [subcommand, positional] = args;
  const separator = args.indexOf('--');
  const commandArgs = separator >= 0 ? args.slice(separator + 1) : [];
  const optionArgs = separator >= 0 ? args.slice(0, separator) : args;
  return {
    subcommand,
    sessionId: positional && !positional.startsWith('-') ? positional : undefined,
    file: optionValue(optionArgs, '--file'),
    output: optionValue(optionArgs, '--output'),
    allowContent: optionArgs.includes('--allow-content'),
    synthetic: optionArgs.includes('--synthetic'),
    confirm: optionArgs.includes('--confirm'),
    sidecarFile: optionValue(optionArgs, '--sidecar'),
    otelFiles: optionValues(optionArgs, '--otel-file'),
    runId: optionValue(optionArgs, '--run-id'),
    taskId: optionValue(optionArgs, '--task-id'),
    repo: optionValue(optionArgs, '--repo'),
    copilotHome: optionValue(optionArgs, '--copilot-home'),
    expectationsFile: optionValue(optionArgs, '--expectations'),
    upload: optionArgs.includes('--upload'),
    yes: optionArgs.includes('--yes'),
    help: optionArgs.includes('--help') || optionArgs.includes('-h'),
    endpoint: optionValue(optionArgs, '--endpoint', otlpHttpEndpoint),
    explicitEndpoint: optionArgs.includes('--endpoint'),
    connectionStringEnv: optionValue(optionArgs, '--appinsights-connection-string-env'),
    agentName: optionValue(optionArgs, '--agent-name'),
    id: optionValue(optionArgs, '--id') || legacy.customEventId(),
    dryRun: optionArgs.includes('--dry-run'),
    json: parseJsonFlag(optionArgs),
    commandArgs
  };
}

function uniqueRunId() {
  return `native_run_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function incompatibleInheritedOtelSettings(env) {
  const names = [
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_EXPORTER_OTLP_HEADERS',
    'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
    'OTEL_EXPORTER_OTLP_CERTIFICATE',
    'OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE',
    'OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE',
    'OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE',
    'OTEL_EXPORTER_OTLP_CLIENT_KEY',
    'OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY'
  ].filter(name => typeof env[name] === 'string' && env[name].trim());
  if (env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL && env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL !== 'http/protobuf') {
    names.push('OTEL_EXPORTER_OTLP_TRACES_PROTOCOL');
  }
  return names;
}

async function launchObservedCopilot(options = {}, dependencies = {}) {
  if (options.upload && !options.yes) throw new Error('copilot-session launch --upload requires --yes; omit --upload to keep evidence local');
  if (options.yes && !options.upload) throw new Error('copilot-session launch --yes requires --upload');
  if (options.taskId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(options.taskId)) throw new Error('task ID must be a bounded metadata identifier');
  const expectations = loadComponentExpectations(options.expectationsFile);
  const env = dependencies.env || process.env;
  const otelConflicts = incompatibleInheritedOtelSettings(env);
  if (otelConflicts.length) {
    throw new Error(`inherited OpenTelemetry settings conflict with the scoped local collector: ${otelConflicts.join(', ')}`);
  }
  const cwd = options.repo || process.cwd();
  const copilotHome = options.copilotHome || env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
  const projectConfigPath = projectAgentOpsConfigPath({ cwd, agentOpsHome: dependencies.agentopsHome || agentopsHome });
  const hasProjectConfig = Boolean(projectConfigPath && fs.existsSync(projectConfigPath));
  const hasExplicitEnvironmentTarget = Boolean(
    (env.AGENTOPS_AZURE_SUBSCRIPTION_ID || env.AZURE_SUBSCRIPTION_ID)
    && env.AGENTOPS_LOGS_INGESTION_ENDPOINT
    && env.AGENTOPS_DCR_IMMUTABLE_ID
  );
  if (options.upload && !hasProjectConfig && !hasExplicitEnvironmentTarget) {
    throw new Error('copilot-session launch --upload requires a project-scoped Azure target; run agentops configure set --project in the target repository or set AGENTOPS_AZURE_SUBSCRIPTION_ID, AGENTOPS_LOGS_INGESTION_ENDPOINT, and AGENTOPS_DCR_IMMUTABLE_ID explicitly');
  }
  const projectCloud = configuredCloudValues({ env, projectConfigPath });
  if (options.upload && (!projectCloud.subscriptionId || !projectCloud.logsIngestionEndpoint || !projectCloud.dcrImmutableId)) {
    throw new Error('copilot-session launch --upload requires a complete Azure target with subscription, Logs Ingestion endpoint, and DCR immutable ID');
  }
  const scopedDeliveryEnv = { ...env };
  if (options.upload && options.yes && projectCloud.subscriptionId && !scopedDeliveryEnv.AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS) {
    scopedDeliveryEnv.AGENTOPS_APPROVED_AZURE_SUBSCRIPTION_IDS = projectCloud.subscriptionId;
  }
  const resolve = dependencies.resolveCopilotBinary || resolveCopilotBinary;
  const resolved = resolve({ env });
  if (!resolved.ok) throw new Error(resolved.error);
  const startCollector = dependencies.startScopedStrictCollector || startScopedStrictCollector;
  const runId = options.runId || uniqueRunId();
  const commandArgs = options.commandArgs || [];
  const executionConfiguration = observedLaunchExecutionConfiguration(commandArgs);
  const preRunSnapshot = capturePreRunSnapshot({ cwd, executionConfiguration, taskId: options.taskId });
  const suppliedSessionIndex = commandArgs.indexOf('--session-id');
  const inlineSession = commandArgs.find(arg => arg.startsWith('--session-id='));
  const resumes = commandArgs.some(arg => ['--resume', '-r', '--continue', '--connect'].includes(arg) || arg.startsWith('--resume=') || arg.startsWith('--connect='));
  const expectedSessionId = suppliedSessionIndex >= 0 ? commandArgs[suppliedSessionIndex + 1]
    : inlineSession ? inlineSession.slice('--session-id='.length) : resumes ? '' : crypto.randomUUID();
  const launchArgs = suppliedSessionIndex >= 0 || inlineSession || !expectedSessionId ? commandArgs : [...commandArgs, '--session-id', expectedSessionId];
  const launchAbort = new AbortController();
  const signals = dependencies.signals || process;
  const abortLaunch = () => launchAbort.abort();
  const externalAbort = dependencies.abortSignal;
  signals.on('SIGINT', abortLaunch);
  signals.on('SIGTERM', abortLaunch);
  externalAbort?.addEventListener('abort', abortLaunch, { once: true });
  if (externalAbort?.aborted) abortLaunch();
  let scopedCollector;
  try {
    scopedCollector = await startCollector({ agentopsHome: dependencies.agentopsHome || agentopsHome, abortSignal: launchAbort.signal });
    if (launchAbort.signal.aborted) {
      const error = new Error('Copilot observation cancelled during collector setup');
      error.name = 'AbortError';
      throw error;
    }
    const endpoint = scopedCollector.endpoint;
    const runEnv = {
      ...env,
      COPILOT_HOME: copilotHome,
      COPILOT_OTEL_ENABLED: 'true',
      COPILOT_OTEL_EXPORTER_TYPE: 'otlp-http',
      COPILOT_OTEL_SOURCE_NAME: 'github.copilot',
      COPILOT_OTEL_CAPTURE_CONTENT: 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_SERVICE_NAME: env.OTEL_SERVICE_NAME || 'github-copilot-cli',
      OTEL_RESOURCE_ATTRIBUTES: [env.OTEL_RESOURCE_ATTRIBUTES, `agentops.run.id=${runId}`, 'agent.framework=github-copilot', 'agent.runtime=github-copilot-cli'].filter(Boolean).join(','),
      AGENTOPS_PRIVACY_MODE: 'strict',
      AGENTOPS_CAPTURE_CONTENT: 'false',
      AGENTOPS_RUN_ID: runId,
      AGENTOPS_SCRIPT_OTLP_ENDPOINT: `${endpoint}/v1/traces`
    };
    const observedEnv = attachedScriptEnvironment({ env: runEnv, cwd, runId, agentopsRoot, collectorMode: 'auto' });
    const sessionRoot = path.join(copilotHome, 'session-state');
    const sourceWindow = { sessionId: expectedSessionId || null, freshSession: Boolean(expectedSessionId) && !fs.existsSync(path.join(sessionRoot, expectedSessionId, 'events.jsonl')), startedAt: new Date().toISOString() };
    const snapshot = (dependencies.snapshotCopilotSessions || snapshotCopilotSessions)(sessionRoot);
    // Legacy injected synchronous runner is retained for existing embedders/tests.
    // Production always uses asynchronous supervision.
    const result = dependencies.spawnSync
      ? dependencies.spawnSync(resolved.path, launchArgs, { cwd, env: observedEnv, stdio: 'inherit' })
      : await (dependencies.superviseProcess || superviseProcess)(resolved.path, launchArgs, { cwd, env: observedEnv, stdio: 'inherit' }, scopedCollector, { ...dependencies, abortSignal: launchAbort.signal });

    // Graceful Collector shutdown flushes the final OTel batches to its
    // strict-redacted local receipt before delivery reads that file.
    await scopedCollector.stop({ remove: false });
    const summary = (dependencies.changedCopilotSession || changedCopilotSession)(snapshot, sessionRoot, expectedSessionId);
    let evidence = null;
    if (summary?.sessionId) {
      const deliver = dependencies.deliverCopilotSession || deliverCopilotSession;
      evidence = deliver({
        summary,
        runId,
        copilotHome,
        cwd,
        agentopsHome: dependencies.agentopsHome || agentopsHome,
        env: scopedDeliveryEnv,
        otelFiles: [scopedCollector.receiptPath],
        upload: Boolean(options.upload),
        expectations,
        executionConfiguration,
        preRunSnapshot,
        sourceWindow,
        lifecycle: { collector: result.collectorFailed ? 'failed' : 'completed', process: result.signal || result.cancelled ? 'cancelled' : 'completed' }
      });
    }
    if (result.error) throw result.error;
    const exitCode = result.status === null ? 1 : result.status;
    const uploadAccepted = !options.upload || evidence?.state === 'azure_acknowledged';
    const output = {
      runId,
      sessionId: summary?.sessionId || '',
      copilotPath: resolved.path,
      exitCode,
      signal: result.signal || '',
      ok: exitCode === 0 && uploadAccepted && !result.collectorFailed && !result.cancelled,
      cancelled: Boolean(result.cancelled),
      collectorStatus: result.collectorFailed ? 'failed' : 'completed',
      evidence
    };
    writeJsonOrRender(output, options.json, value => [
      'Native Copilot observation',
      `Run: ${value.runId}`,
      `Session: ${value.sessionId || 'not detected'}`,
      `Copilot exit: ${value.exitCode}${value.signal ? ` (${value.signal})` : ''}`,
      `Evidence: ${value.evidence ? `${value.evidence.events} events, ${value.evidence.spans} spans · ${value.evidence.state}` : 'not collected'}`,
      ...(value.evidence?.outputDir ? [`Local evidence: ${value.evidence.outputDir}`] : []),
      ...(options.upload ? [] : ['Azure: not requested; evidence remains local'])
    ].join('\n') + '\n');
    process.exitCode = output.exitCode || (output.ok ? 0 : 1);
    return output;
  } finally {
    try { await scopedCollector?.stop({ remove: true }); } finally {
      signals.removeListener('SIGINT', abortLaunch);
      signals.removeListener('SIGTERM', abortLaunch);
      externalAbort?.removeEventListener('abort', abortLaunch);
    }
  }
}

async function buildCopilotSessionEnrichment(options = {}) {
  if (options.subcommand !== 'enrich') throw new Error('copilot-session supports: enrich <session-id>');
  if (!options.sessionId && !options.file) throw new Error('copilot-session enrich requires <session-id> or --file <events.jsonl>');

  const eventsFile = options.file || defaultSessionEventsPath(options.sessionId);
  const sessionId = options.sessionId || path.basename(path.dirname(eventsFile));
  const sidecarFile = options.sidecarFile || path.join(process.cwd(), '.agentops', 'sidecar-events.jsonl');
  const rawEvents = [
    ...readCopilotSessionEvents(eventsFile),
    ...readScriptSidecarEvents(sidecarFile, sessionId)
  ].sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')));
  const rows = enrichCopilotSessionEvents(rawEvents, { sessionId });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-copilot-session-'));
  const outFile = path.join(tempDir, 'AgentOpsCopilotSessionEnrichment.jsonl');

  try {
    writeJsonlFile(outFile, rows, { trailingNewline: true });
    const result = await legacy.agentopsCustomImport(outFile, {
      id: options.id,
      endpoint: options.endpoint,
      dryRun: options.dryRun,
      last: '2h'
    });
    return {
      ...result,
      ok: result.ok && rows.length > 0,
      session_id: sessionId,
      source_file: eventsFile,
      sidecar_file: sidecarFile,
      enriched_rows: rows.length,
      event_counts: rows.reduce((counts, row) => {
        counts[row.event] = (counts[row.event] || 0) + 1;
        return counts;
      }, {}),
      preview: rows.slice(0, 8).map(row => ({
        event: row.event,
        agent: row.agent,
        skill: row.attributes?.['agentops.skill.name'] || '',
        mcp_server: row.attributes?.['agentops.mcp.server'] || '',
        script: row.attributes?.['agentops.script.name'] || '',
        tool: row.attributes?.['gen_ai.tool.name'] || '',
        outcome: row.outcome || ''
      }))
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function renderCopilotSessionEnrichment(result = {}) {
  const lines = [
    'Copilot session enrichment',
    `Session: ${result.session_id}`,
    `Source: ${result.source_file}`,
    `Rows: ${result.enriched_rows}`,
    `Dry run: ${Boolean(result.dry_run)}`,
    `OK: ${Boolean(result.ok)}`
  ];
  if (result.event_counts) {
    lines.push('', 'Events:');
    for (const [event, count] of Object.entries(result.event_counts)) lines.push(`- ${event}: ${count}`);
  }
  if (result.next?.length) {
    lines.push('', 'Next:');
    for (const item of result.next) lines.push(`- ${item}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderCopilotSessionCollection(result = {}) {
  const lines = [
    'Copilot session evidence',
    `Session: ${result.sessionId || 'unknown'}`,
    `Run: ${result.runId || 'unknown'}`,
    `State: ${result.state || 'unknown'}`,
    `Events: ${result.events || 0}`,
    `Spans: ${result.spans || 0}`,
    `Local evidence: ${result.outputDir || 'not written'}`,
    ...(result.reason ? [`Note: ${result.reason}`] : [])
  ];
  return `${lines.join('\n')}\n`;
}

async function copilotSessionCommand(args = [], dependencies = {}) {
  const options = parseCopilotSessionArgs(args);
  if (options.subcommand === 'launch' && options.help) {
    const stdout = dependencies.stdout || process.stdout;
    stdout.write('agentops copilot-session launch [--repo <git-repo>] [--copilot-home <path>] [--expectations <manifest.json>] [--task-id <id>] [--upload --yes] [--json] -- [copilot-args...]\n');
    stdout.write('Starts one process-scoped Copilot CLI observation run. Evidence stays local unless --upload --yes is explicit.\n');
    stdout.write('Azure upload requires a complete project-scoped target or all three explicit Azure target environment values.\n');
    return { ok: true, action: 'help' };
  }
  if (options.subcommand === 'launch') return launchObservedCopilot(options, dependencies);
  if (options.subcommand === 'collect') {
    if (!options.sessionId) throw new Error('copilot-session collect requires <session-id>');
    if (!options.runId) throw new Error('copilot-session collect requires --run-id <observed-run-id>');
    if (options.upload && !options.yes) throw new Error('copilot-session collect --upload requires --yes; omit --upload to keep evidence local');
    if (options.yes && !options.upload) throw new Error('copilot-session collect --yes requires --upload');
    const collect = dependencies.deliverCopilotSession || deliverCopilotSession;
    const result = collect({
      summary: { sessionId: options.sessionId },
      runId: options.runId,
      cwd: options.repo || process.cwd(),
      copilotHome: options.copilotHome || process.env.COPILOT_HOME,
      agentopsHome,
      env: process.env,
      otelFiles: options.otelFiles.length ? options.otelFiles : defaultReceiptFiles(),
      upload: options.upload
    });
    writeJsonOrRender({ ok: options.upload ? result.state === 'azure_acknowledged' : result.state !== 'native_best_effort', ...result }, options.json, renderCopilotSessionCollection);
    if (options.upload && result.state !== 'azure_acknowledged') process.exitCode = 1;
    return;
  }
  if (options.subcommand === 'export-content') {
    if (!options.sessionId && !options.file) throw new Error('copilot-session export-content requires <session-id> or --file <events.jsonl>');
    if (!options.allowContent || !options.synthetic) throw new Error('copilot-session export-content requires --allow-content --synthetic');
    const eventsFile = options.file || defaultSessionEventsPath(options.sessionId);
    const sessionId = options.sessionId || path.basename(path.dirname(eventsFile));
    const result = writeSessionContent(readCopilotSessionEvents(eventsFile), sessionId, options.output, options.runId || sessionId);
    writeJsonOrRender({
      ok: true,
      session_id: sessionId,
      privacy_profile: 'restricted_local',
      synthetic_provenance: 'user_declared_unverified',
      redaction_status: 'best_effort_redacted',
      ...result
    }, options.json, value => `Restricted local content rows: ${value.rows} in ${value.output} · synthetic origin declared by user, unverified · best-effort redaction\n`);
    return;
  }
  if (options.subcommand === 'delete-content') {
    if (!options.sessionId) throw new Error('copilot-session delete-content requires <session-id>');
    if (!options.file) throw new Error('copilot-session delete-content requires --file <dir>/AgentOpsContent_CL.jsonl');
    const runId = options.runId || options.sessionId;
    const result = deleteSessionContent(options.file, options.sessionId, runId, { confirm: options.confirm });
    writeJsonOrRender({
      ok: true,
      session_id: options.sessionId,
      run_id: runId,
      scope: 'local_only',
      azure_deletion_claimed: false,
      ...result
    }, options.json, value => [
      'Restricted local content retention',
      `Session: ${value.session_id}`,
      `Run: ${value.run_id}`,
      `File: ${value.file}`,
      `Rows selected: ${value.rows}`,
      value.mode === 'preview'
        ? 'Preview only — nothing deleted. Re-run with --confirm to delete this exact file.'
        : value.deleted
          ? 'Deleted (local only).'
          : 'File was not found; nothing deleted.',
      'Scope: this exact session/run file only — no directory-wide wipe, no other run touched.',
      'This is LOCAL-only deletion and makes no claim about any Azure-side copy.'
    ].join('\n') + '\n');
    return;
  }
  if (options.subcommand === 'export-spans') {
    if (!options.sessionId && !options.file) throw new Error('copilot-session export-spans requires <session-id> or --file <events.jsonl>');
    if (!options.runId) throw new Error('copilot-session export-spans requires --run-id <observed-run-id>');
    const eventsFile = options.file || defaultSessionEventsPath(options.sessionId);
    const sessionId = options.sessionId || path.basename(path.dirname(eventsFile));
    const sessionEvents = readCopilotSessionEvents(eventsFile);
    const native = readSessionOtelSpans(sessionId, options.otelFiles.length ? options.otelFiles : defaultReceiptFiles(), { runId: options.runId });
    const spans = enrichSpansWithSessionToolContext(native.spans, sessionEvents);
    const result = writeSessionSpans(spans, sessionId, options.runId, options.output);
    writeJsonOrRender({ ok: true, session_id: sessionId, run_id: options.runId, native_spans: native.spans.filter(span => span.match === 'exact-session').length, run_linked_script_spans: native.spans.filter(span => span.match === 'run-linked-script').length, ...result }, options.json, value => `Synthetic run spans: ${value.rows} rows in ${value.output}\n`);
    return;
  }
  if (options.subcommand === 'export-otel') {
    if (!options.sessionId) throw new Error('copilot-session export-otel requires <session-id>');
    if (!options.runId) throw new Error('copilot-session export-otel requires --run-id <observed-run-id>');
    if (options.allowContent) throw new Error('copilot-session export-otel is metadata-only; --allow-content is not supported');
    if (options.explicitEndpoint && options.connectionStringEnv) throw new Error('choose one of --endpoint or --appinsights-connection-string-env');
    const result = await exportSessionGenAi({
      sessionId: options.sessionId,
      runId: options.runId,
      eventsFile: options.file,
      otelFiles: options.otelFiles,
      agentName: options.agentName,
      output: options.output,
      dryRun: options.dryRun,
      endpoint: options.explicitEndpoint ? options.endpoint : undefined,
      connectionStringEnv: options.connectionStringEnv
    });
    writeJsonOrRender({ ok: true, ...result }, options.json, renderGenAiExport);
    return;
  }
  if (options.subcommand === 'export-events') {
    if (!options.sessionId && !options.file) throw new Error('copilot-session export-events requires <session-id> or --file <events.jsonl>');
    if (!options.runId) throw new Error('copilot-session export-events requires --run-id <observed-run-id>');
    const eventsFile = options.file || defaultSessionEventsPath(options.sessionId);
    const sessionId = options.sessionId || path.basename(path.dirname(eventsFile));
    const result = writeSessionEvents(readCopilotSessionEvents(eventsFile), sessionId, options.runId, options.output);
    writeJsonOrRender({ ok: true, session_id: sessionId, run_id: options.runId, ...result }, options.json, value => `Session metadata events: ${value.rows} rows in ${value.output}\n`);
    return;
  }
  if (options.subcommand === 'view') {
    if (!options.sessionId && !options.file) throw new Error('copilot-session view requires <session-id> or --file <events.jsonl>');
    // Default is metadata-only: prompts, tool arguments/results and other raw
    // payload content are redacted from the rendered timeline. --allow-content
    // opts into the full-content rendering that previously was the only mode
    // (and still persists raw content to the local HTML file — see the
    // in-page warning session-waterfall.js renders for that mode).
    const metadataOnly = !options.allowContent;
    const eventsFile = options.file || defaultSessionEventsPath(options.sessionId);
    const sessionId = options.sessionId || path.basename(path.dirname(eventsFile));
    const sessionEvents = readCopilotSessionEvents(eventsFile);
    const native = readSessionOtelSpans(sessionId, options.otelFiles.length ? options.otelFiles : defaultReceiptFiles(), { runId: options.runId });
    let joinedSpans = enrichSpansWithSessionToolContext(native.spans, sessionEvents);
    let invalidNativeRecords = native.invalid;
    let deliveryStatus = null;
    let launchExecutionConfiguration = null;
    let modelProvenance = null;
    if (options.runId) {
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(options.runId)) throw new Error('copilot-session view requires a safe --run-id');
      const runDirectory = path.join(agentopsHome, 'runs', options.runId);
      try {
        const contextFile = path.join(runDirectory, 'run-context.json');
        const stat = fs.lstatSync(contextFile);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024) {
          const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
          if (context.sessionId === sessionId && context.runId === options.runId) {
            launchExecutionConfiguration = context.launchExecutionConfiguration || context.executionConfiguration || null;
            modelProvenance = context.modelProvenance || null;
          }
        }
      } catch {}
      let outbox = null;
      try { outbox = readSessionOutbox(runDirectory); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      deliveryStatus = outbox?.sessionId === sessionId && outbox.runId === options.runId
        ? outbox
        : { streams: { events: { status: 'not_observed', rows: 0, attempts: 0 }, spans: { status: 'not_observed', rows: 0, attempts: 0 } } };
      if (outbox?.sessionId === sessionId && outbox.runId === options.runId) {
        const exported = readSessionSpanRows(runDirectory, options.runId, sessionId);
        if (exported.spans.length) {
          joinedSpans = enrichSpansWithSessionToolContext(exported.spans, sessionEvents);
          invalidNativeRecords += exported.invalid;
        }
      }
    }
    const output = writeSessionWaterfall(sessionEvents, sessionId, options.output, { nativeSpans: joinedSpans, deliveryStatus, metadataOnly, launchExecutionConfiguration, modelProvenance });
    const contentWarning = metadataOnly
      ? 'Metadata only: prompts, tool arguments/results and other raw content are redacted. Pass --allow-content to render full content (persists raw content in this local HTML file).'
      : 'Full content rendered: this local HTML file contains raw prompts, tool arguments/results and other captured payloads. Treat it as sensitive.';
    writeJsonOrRender({ ok: true, session_id: sessionId, output, content_mode: metadataOnly ? 'metadata_only' : 'full_content_local_only', content_warning: contentWarning, native_spans: joinedSpans.filter(span => span.match === 'exact-session').length, run_linked_script_spans: joinedSpans.filter(span => span.match === 'run-linked-script').length, native_receipt_files: native.files.length, invalid_native_records: invalidNativeRecords }, options.json, result => `Local waterfall: ${result.output} · ${result.native_spans} native OTel spans · ${result.run_linked_script_spans} run-linked script spans\n${result.content_warning}\n`);
    return;
  }
  const result = await buildCopilotSessionEnrichment(options);
  writeJsonOrRender(result, options.json, renderCopilotSessionEnrichment);
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = {
  buildCopilotSessionEnrichment,
  copilotSessionCommand,
  launchObservedCopilot,
  parseCopilotSessionArgs,
  renderCopilotSessionCollection,
  renderCopilotSessionEnrichment
};
