const childProcess = require('node:child_process');
const path = require('node:path');

const legacy = require('../../legacy');
const collector = require('../collector-manager');
const { optionValue, withoutFlags } = require('../args');
const { appendWrapperEvent, createWrapperEnvelope } = require('./wrapper-envelope');
const { resolveCopilotBinary } = require('../copilot-resolver');
const { copilotDir } = require('../paths');
const { changedCopilotSession, snapshotCopilotSessions } = require('./receipt-session');
const { receiptDeliveryText } = require('../delivery-state');
const { createWrapperDelivery } = require('./wrapper-delivery');

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

function safeReceiptName(value = '') {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_.:/@+-]{1,200}$/.test(text) ? text : '';
}

function renderCopilotReceipt({ envelope, exitCode, privacy = 'strict', requestedPrivacy = privacy, fallbackUnobserved = false, deliveryState = 'native_best_effort', replayUrl = '', summary = null, wallDurationMs = 0, agent = '' }) {
  const completed = Number(exitCode) === 0;
  const lines = [
    '',
    'AgentOps receipt',
    `Result      ${completed ? 'Completed' : 'Needs attention'} · exit ${Number.isInteger(exitCode) ? exitCode : 1}`,
    `Copilot     ${summary?.sessionId || 'session details pending'}`,
    `Delivery    ${receiptDeliveryText(fallbackUnobserved ? 'unobserved' : deliveryState)}`,
    ...(fallbackUnobserved ? [] : ['Coverage    Detailed Copilot activity is best effort; use agentops latest to check what arrived']),
    `Privacy     ${privacy}${requestedPrivacy !== privacy ? ` effective · ${requestedPrivacy} requested` : ''} · AgentOps did not record prompts, answers, code, or tool payloads`,
  ];
  if (safeReceiptName(agent)) lines.push(`Agent       ${safeReceiptName(agent)}`);
  if (summary?.model) lines.push(`Model       ${summary.model}`);
  if (summary && (summary.inputTokens || summary.outputTokens)) lines.push(`Tokens      ${summary.inputTokens.toLocaleString()} in · ${summary.outputTokens.toLocaleString()} out`);
  if (summary?.aiCredits) lines.push(`AI credits  ${summary.aiCredits.toFixed(1)}`);
  const timing = [];
  if (wallDurationMs) timing.push(`${(wallDurationMs / 1000).toFixed(1)}s wall`);
  if (summary?.apiDurationMs) timing.push(`${(summary.apiDurationMs / 1000).toFixed(1)}s API`);
  if (timing.length) lines.push(`Time        ${timing.join(' · ')}`);
  if (summary?.tools?.length) lines.push(`Tools       ${summary.tools.length} · ${summary.tools.slice(0, 4).join(', ')}${summary.tools.length > 4 ? ', …' : ''}`);
  if (summary && (summary.filesModified || summary.linesAdded || summary.linesRemoved)) lines.push(`Code        ${summary.filesModified} files · +${summary.linesAdded} / -${summary.linesRemoved}`);
  lines.push(`Details     agentops latest · run ${envelope.runId} · wrapper session ${envelope.sessionId}`);
  if (replayUrl) lines.push(`Run Story   ${replayUrl}`);
  return `${lines.join('\n')}\n`;
}

async function copilotCommand(args = []) {
  const helpOnly = args.includes('--help') || args.includes('-h');
  const mode = optionValue(args, '--collector-mode', process.env.AGENTOPS_COLLECTOR_MODE || 'auto');
  const privacy = optionValue(args, '--privacy', process.env.AGENTOPS_PRIVACY_MODE || 'strict');
  const unsafeNoCollector = args.includes('--unsafe-no-collector') || process.env.AGENTOPS_ALLOW_NO_COLLECTOR === '1';
  const observedArgs = removeAgentOpsCopilotFlags(args);
  if (helpOnly) {
    const resolved = resolveCopilotBinary();
    if (!resolved.ok) throw new Error(resolved.error);
    const help = childProcess.spawnSync(resolved.path, observedArgs, { stdio: 'inherit', env: process.env });
    if (help.error) throw help.error;
    process.exitCode = help.status === null ? 1 : help.status;
    return;
  }
  const requestedAgent = optionValue(observedArgs, '--agent', '');
  const envelope = createWrapperEnvelope();
  const wrapperDelivery = createWrapperDelivery();
  const durableEventIds = [];
  let wrapperSequence = 0;
  let deliveryState = 'native_best_effort';
  let fallbackUnobserved = false;
  const baseEvent = {
    RunId: envelope.runId,
    SessionId: envelope.sessionId,
    Surface: 'cli',
    PrivacyMode: privacy,
    CollectorMode: mode
  };
  const recordLifecycle = event => {
    const file = appendWrapperEvent(event);
    const recorded = wrapperDelivery.record(event, { sequence: ++wrapperSequence });
    if (recorded.evidence?.EventId) durableEventIds.push(recorded.evidence.EventId);
    if (recorded.state === 'overflow' || deliveryState !== 'overflow') deliveryState = recorded.state;
    return { file, recorded };
  };

  recordLifecycle({
    ...baseEvent,
    EventName: 'agentops.run.start'
  });

  const currentStatus = await collector.status({ mode, privacy });
  let effectivePrivacy = currentStatus.running && currentStatus.privacyMode
    ? currentStatus.privacyMode
    : privacy;
  if (!currentStatus.running && mode !== 'none') {
    const started = await collector.start({ mode, privacy, unsafeNoCollector });
    effectivePrivacy = started.privacyMode || privacy;
    if (!started.ok) {
      recordLifecycle({
        ...baseEvent,
        EventName: 'agentops.collector.start_failed',
        Reason: started.error || 'collector start failed'
      });
      if (process.env.AGENTOPS_ALLOW_UNOBSERVED_FALLBACK === '1') {
        fallbackUnobserved = true;
        const eventFile = recordLifecycle({
          ...baseEvent,
          EventName: 'agentops.wrapper.fallback_unobserved',
          Reason: started.error || 'collector start failed'
        });
        process.stderr.write(`WARNING: AgentOps collector unavailable; running unobserved because AGENTOPS_ALLOW_UNOBSERVED_FALLBACK=1. ${started.error || ''}\n`);
        process.stderr.write(`AgentOps wrapper fallback event: ${eventFile.file}\n`);
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
  const sessionsBefore = snapshotCopilotSessions();
  const runStartedAt = Date.now();
  const env = {
    ...process.env,
    COPILOT_CLI_BIN: resolved.path,
    AGENTOPS_PRIVACY_MODE: effectivePrivacy,
    AGENTOPS_COLLECTOR_MODE: mode,
    AGENTOPS_WRAPPER_RUN_ID: envelope.runId,
    AGENTOPS_WRAPPER_SESSION_ID: envelope.sessionId,
    AGENTOPS_WRAPPER_FALLBACK_UNOBSERVED: fallbackUnobserved ? 'true' : 'false'
  };
  const result = childProcess.spawnSync(observeScript, observedArgs, { stdio: 'inherit', env });
  const wallDurationMs = Date.now() - runStartedAt;
  const summary = changedCopilotSession(sessionsBefore);
  recordLifecycle({
    ...baseEvent,
    EventName: 'agentops.run.end',
    ExitCode: result.status === null ? 1 : result.status,
    Error: result.error ? result.error.message : '',
    FallbackUnobserved: fallbackUnobserved
  });
  const drained = await wrapperDelivery.drain(durableEventIds);
  if (drained.state === 'azure_acknowledged' || deliveryState !== 'overflow') deliveryState = drained.state;
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
  if (process.env.AGENTOPS_PRINT_RUN_LINK !== 'false') {
    process.stderr.write(renderCopilotReceipt({
      envelope,
      exitCode: process.exitCode,
      privacy: effectivePrivacy,
      requestedPrivacy: privacy,
      fallbackUnobserved,
      deliveryState,
      replayUrl: wrapperReplayUrl(summary?.sessionId ? { runId: '__all', sessionId: summary.sessionId } : envelope),
      summary,
      wallDurationMs,
      agent: requestedAgent
    }));
  }
}

module.exports = {
  copilotCommand,
  receiptDeliveryText,
  removeAgentOpsCopilotFlags,
  renderCopilotReceipt,
  safeReceiptName,
  wrapperReplayUrl
};
