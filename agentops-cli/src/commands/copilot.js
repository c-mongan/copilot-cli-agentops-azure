const childProcess = require('node:child_process');
const path = require('node:path');

const collector = require('../lib/collector-manager');
const legacy = require('../legacy');
const { optionValue, withoutFlags } = require('../lib/args');
const { appendWrapperEvent, createWrapperEnvelope } = require('../lib/copilot/wrapper-envelope');
const { resolveCopilotBinary } = require('../lib/copilot-resolver');
const { copilotDir } = require('../lib/paths');

function removeAgentOpsCopilotFlags(args) {
  return withoutFlags(args, ['--collector-mode', '--privacy', '--unsafe-no-collector']);
}

function wrapperReplayUrl(envelope = createWrapperEnvelope(), links = legacy.openLinksSummary()) {
  const base = String(links.v2_replay_url || '').split('?')[0];
  if (!base) return '';
  const params = new URLSearchParams({
    'var-run_id': envelope.runId || '__all',
    'var-session_id': envelope.sessionId || '__all'
  });
  return `${base}?${params.toString()}`;
}

async function copilotCommand(args = []) {
  const helpOnly = args.includes('--help') || args.includes('-h');
  const mode = optionValue(args, '--collector-mode', process.env.AGENTOPS_COLLECTOR_MODE || 'auto');
  const privacy = optionValue(args, '--privacy', process.env.AGENTOPS_PRIVACY_MODE || 'strict');
  const unsafeNoCollector = args.includes('--unsafe-no-collector') || process.env.AGENTOPS_ALLOW_NO_COLLECTOR === '1';
  const observedArgs = removeAgentOpsCopilotFlags(args);
  const envelope = createWrapperEnvelope();
  let fallbackUnobserved = false;
  const baseEvent = {
    RunId: envelope.runId,
    SessionId: envelope.sessionId,
    Surface: 'cli',
    PrivacyMode: privacy,
    CollectorMode: mode
  };

  if (helpOnly) {
    const resolved = resolveCopilotBinary();
    if (!resolved.ok) throw new Error(resolved.error);
    const help = childProcess.spawnSync(resolved.path, observedArgs, { stdio: 'inherit', env: process.env });
    if (help.error) throw help.error;
    process.exitCode = help.status === null ? 1 : help.status;
    return;
  }

  appendWrapperEvent({
    ...baseEvent,
    EventName: 'agentops.run.start'
  });

  const currentStatus = await collector.status({ mode, privacy });
  if (!currentStatus.running && mode !== 'none') {
    const started = await collector.start({ mode, privacy, unsafeNoCollector });
    if (!started.ok) {
      appendWrapperEvent({
        ...baseEvent,
        EventName: 'agentops.collector.start_failed',
        Reason: started.error || 'collector start failed'
      });
      if (process.env.AGENTOPS_ALLOW_UNOBSERVED_FALLBACK === '1') {
        fallbackUnobserved = true;
        const eventFile = appendWrapperEvent({
          ...baseEvent,
          EventName: 'agentops.wrapper.fallback_unobserved',
          Reason: started.error || 'collector start failed'
        });
        process.stderr.write(`WARNING: AgentOps collector unavailable; running unobserved because AGENTOPS_ALLOW_UNOBSERVED_FALLBACK=1. ${started.error || ''}\n`);
        process.stderr.write(`AgentOps wrapper fallback event: ${eventFile}\n`);
      } else {
        throw new Error(`AgentOps collector unavailable: ${started.error || 'unknown error'}`);
      }
    }
  }

  if (mode === 'none' && !unsafeNoCollector) {
    throw new Error('Collector mode none requires AGENTOPS_ALLOW_NO_COLLECTOR=1 or --unsafe-no-collector.');
  }

  const resolved = resolveCopilotBinary();
  if (!resolved.ok) throw new Error(resolved.error);

  const observeScript = path.join(copilotDir, 'copilot-observe');
  const env = {
    ...process.env,
    COPILOT_CLI_BIN: resolved.path,
    AGENTOPS_PRIVACY_MODE: privacy,
    AGENTOPS_COLLECTOR_MODE: mode,
    AGENTOPS_WRAPPER_RUN_ID: envelope.runId,
    AGENTOPS_WRAPPER_SESSION_ID: envelope.sessionId,
    AGENTOPS_WRAPPER_FALLBACK_UNOBSERVED: fallbackUnobserved ? 'true' : 'false'
  };
  const result = childProcess.spawnSync(observeScript, observedArgs, { stdio: 'inherit', env });
  appendWrapperEvent({
    ...baseEvent,
    EventName: 'agentops.run.end',
    ExitCode: result.status === null ? 1 : result.status,
    Error: result.error ? result.error.message : '',
    FallbackUnobserved: fallbackUnobserved
  });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
  if (process.exitCode === 0 && process.env.AGENTOPS_PRINT_RUN_LINK !== 'false') {
    process.stderr.write(`AgentOps Run Replay: ${wrapperReplayUrl(envelope)}\n`);
  }
}

module.exports = {
  copilotCommand,
  removeAgentOpsCopilotFlags,
  wrapperReplayUrl
};
