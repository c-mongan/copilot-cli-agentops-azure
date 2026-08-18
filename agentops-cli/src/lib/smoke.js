const fs = require('node:fs');

const { otlpHttpEndpoint } = require('./collector-endpoints');
const { findCollectorBinary } = require('./collector-discovery');
const { startLocalCollector } = require('./collector-binary-runtime');
const { readNativeReceiptFile } = require('./native-receipt');
const { sleep } = require('./timing');
const { validateKqlDuration } = require('./kql');
const {
  commandShellQuote,
  durationToMs,
  parseSmokeArgs,
  realCopilotSmokeArgs,
  realCopilotSmokeCommand
} = require('./smoke-cli');
const {
  attributionSmokeId,
  liveReplayGrafanaUrl,
  liveReplaySmokeId,
  otlpAttributionSmokeTracePayload,
  otlpLiveReplaySmokeTracePayload,
  otlpSmokeTracePayload,
  smokeAzureQuery,
  smokeId
} = require('./smoke-payloads');
const {
  openUrlInBrowser,
  postJson,
  runRealCopilotSmoke,
  verifySmokeInAzure,
  waitForLatestRunSummary
} = require('./smoke-runtime');

async function readLocalReceiptAfterPost(filePath, baselineBytes, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let bytes = 0;
  let readback = readNativeReceiptFile(filePath);
  while (Date.now() < deadline) {
    try { bytes = fs.statSync(filePath).size; } catch { bytes = 0; }
    if (bytes > baselineBytes) {
      readback = readNativeReceiptFile(filePath);
      if (readback.ok) {
        return { ok: true, bytes, ...readback };
      }
    }
    await sleep(100);
  }
  return { ok: false, bytes, ...readback, reason: readback.reason || 'LOCAL_RECEIPT_READBACK_TIMEOUT' };
}

async function agentopsSmoke(options = {}) {
  const endpoint = (options.endpoint || otlpHttpEndpoint).replace(/\/$/, '');
  const id = options.id || smokeId(options.now);
  const last = validateKqlDuration(options.last || '2h');
  const query = smokeAzureQuery(id, last);
  const waitMs = durationToMs(options.waitMs ?? options.wait, 60000);
  const pollMs = durationToMs(options.pollMs ?? options.poll, 10000);
  const realCopilot = Boolean(options.realCopilot);
  const verify = options.verify !== false;
  const result = {
    smoke_kind: options.local ? 'local-collector' : 'collector',
    local_only: Boolean(options.local),
    smoke_id: id,
    endpoint,
    dry_run: Boolean(options.dryRun),
    real_copilot: realCopilot,
    verify,
    wait_ms: waitMs,
    poll_ms: pollMs,
    workspace_id: options.local ? null : (options.workspaceId || options.defaultWorkspaceId),
    azure_query: options.local ? null : query,
    payload_preview: {
      service: 'github-copilot-cli',
      operation: 'smoke_test',
      content_capture_enabled: false
    }
  };

  if (options.dryRun) {
    const next = [
      `POST ${endpoint}/v1/traces`,
      'node agentops-cli/src/index.js validate-azure',
      verify
        ? `node agentops-cli/src/index.js smoke --id ${id} --wait ${Math.ceil(waitMs / 1000)}s --poll ${Math.ceil(pollMs / 1000)}s${realCopilot ? ' --real-copilot' : ''}${options.openBrowser ? ' --open-browser' : ''}`
        : options.local
          ? `node agentops-cli/src/index.js smoke --local --id ${id} --no-verify`
          : `az monitor log-analytics query --workspace "${result.workspace_id}" --analytics-query "<azure_query>"`
    ];
    if (realCopilot) {
      next.push(realCopilotSmokeCommand());
      next.push(options.openBrowser
        ? 'The successful real-Copilot smoke opens Run Story after latest-run visibility is verified.'
        : `node agentops-cli/src/index.js open latest --last ${last}`);
    }
    return {
      ...result,
      ok: true,
      copilot_command: realCopilot ? realCopilotSmokeCommand() : null,
      next
    };
  }

  let localCollector = null;
  let localReceiptBaselineBytes = 0;
  let localReceiptPath = null;
  let realCopilotReceiptBaselineBytes = 0;
  let realCopilotReceipt = null;
  if (options.local) {
    localCollector = await startLocalCollector({
      privacy: 'strict',
      findCollectorBinary: options.findCollectorBinary || findCollectorBinary
    });
    if (!localCollector.ok) {
      return {
        ...result,
        ok: false,
        local_collector: localCollector,
        next: ['Install or expose otelcol-contrib, then rerun `agentops smoke --local`.']
      };
    }
    localReceiptPath = localCollector.receiptPath || null;
    try { localReceiptBaselineBytes = fs.statSync(localReceiptPath).size; } catch { localReceiptBaselineBytes = 0; }
  }

  const post = options.postJson || postJson;
  const response = await post(`${endpoint}/v1/traces`, otlpSmokeTracePayload(id, options.nowMs), options);
  const localReceipt = options.local && response.ok && localReceiptPath
    ? await readLocalReceiptAfterPost(localReceiptPath, localReceiptBaselineBytes)
    : null;
  let copilotRun = null;
  let verification = null;
  let latestVisibility = null;
  let links = null;
  let browserOpen = null;
  if (response.ok && realCopilot) {
    if (options.local && localReceiptPath) {
      try { realCopilotReceiptBaselineBytes = fs.statSync(localReceiptPath).size; } catch { realCopilotReceiptBaselineBytes = 0; }
    }
    copilotRun = runRealCopilotSmoke({ ...options, endpoint });
    if (options.local && copilotRun.ok && localReceiptPath) {
      realCopilotReceipt = await readLocalReceiptAfterPost(localReceiptPath, realCopilotReceiptBaselineBytes, 8000);
    }
    if (copilotRun.ok && !options.local) {
      latestVisibility = await waitForLatestRunSummary({
        ...options,
        last,
        waitMs,
        pollMs
      });
      if (latestVisibility.ok && options.openLinksSummary) links = options.openLinksSummary(latestVisibility.summary);
      const investigationUrl = links?.azure_agents_view_url || links?.v2_replay_url;
      if (options.openBrowser && investigationUrl) {
        browserOpen = openUrlInBrowser(investigationUrl, options);
      }
    }
  }
  if (response.ok && verify) {
    verification = await verifySmokeInAzure(id, {
      ...options,
      last,
      waitMs,
      pollMs
    });
  }
  const ok = response.ok
    && (!options.local || localReceipt?.ok === true)
    && (!realCopilot || copilotRun?.ok === true)
    && (!options.local || !realCopilot || realCopilotReceipt?.ok === true)
    && (!verify || verification?.ok === true);
  const investigationUrl = links?.azure_agents_view_url || links?.v2_replay_url;
  const investigationLabel = links?.azure_agents_view_url ? 'Azure Monitor Agents view' : 'Run Story';
  return {
    ...result,
    ok,
    collector_response: response,
    copilot_run: copilotRun,
    latest_visibility: latestVisibility,
    verification,
    local_receipt: localReceipt,
    real_copilot_receipt: realCopilotReceipt,
    links,
    browser_open: browserOpen,
    local_collector: localCollector,
    next: response.ok
      ? (verification?.ok
          ? [
              `Verified ${verification.rows} smoke row${verification.rows === 1 ? '' : 's'} in Log Analytics.`,
              realCopilot && investigationUrl
                ? `${browserOpen?.ok ? 'Opened' : 'Open'} ${investigationLabel}: ${investigationUrl}`
                : 'node agentops-cli/src/index.js latest --last 2h',
              realCopilot && investigationUrl ? 'node agentops-cli/src/index.js triage latest --out .agentops/triage/latest --json' : 'node agentops-cli/src/index.js latest --last 2h'
            ]
          : [
              verify
                ? `Smoke was sent, but Log Analytics did not return ${id} before the wait expired.`
                : options.local
                  ? localReceipt?.ok
                    ? `Local Collector accepted the privacy-safe OTLP smoke payload and appended a ${localReceipt.status} native receipt.`
                    : 'Local Collector accepted the OTLP request, but the native receipt sink was not read back before the timeout.'
                  : options.local
                    ? 'Local Collector accepted the privacy-safe OTLP smoke payload; inspect the native receipt with `agentops open latest --json`.'
                  : `Run this Azure query after ingestion latency settles: ${query}`,
              realCopilot && investigationUrl
                ? `Open ${investigationLabel}: ${investigationUrl}`
                : options.local
                  ? 'agentops open latest --json'
                  : 'node agentops-cli/src/index.js validate-azure'
            ])
      : [options.local
          ? 'Start the local strict collector with `agentops collector start --mode local --privacy strict`.'
          : 'Start the collector with `node agentops-cli/src/index.js collector start` or `./scripts/collector-azuremonitor-up.sh`.']
  };
}

async function agentopsAttributionSmoke(options = {}) {
  const endpoint = (options.endpoint || otlpHttpEndpoint).replace(/\/$/, '');
  const id = options.id || attributionSmokeId(options.now);
  const last = validateKqlDuration(options.last || '2h');
  const query = smokeAzureQuery(id, last);
  const waitMs = durationToMs(options.waitMs ?? options.wait, 60000);
  const pollMs = durationToMs(options.pollMs ?? options.poll, 10000);
  const verify = options.verify !== false;
  const result = {
    smoke_kind: 'attribution',
    smoke_id: id,
    endpoint,
    dry_run: Boolean(options.dryRun),
    verify,
    wait_ms: waitMs,
    poll_ms: pollMs,
    workspace_id: options.workspaceId || options.defaultWorkspaceId,
    azure_query: query,
    payload_preview: {
      service: 'github-copilot-cli',
      operation: 'attribution_smoke',
      agent: 'agentops-kitchen-sink-smoke',
      skill: 'agentops-attribution',
      mcp_server: 'azure-mcp',
      script: 'pre-tool-policy',
      content_capture_enabled: false
    }
  };

  if (options.dryRun) {
    return {
      ...result,
      ok: true,
      next: [
        `POST ${endpoint}/v1/traces`,
        'node agentops-cli/src/index.js attribution --last 2h',
        verify
          ? `node agentops-cli/src/index.js attribution-smoke --id ${id} --wait ${Math.ceil(waitMs / 1000)}s --poll ${Math.ceil(pollMs / 1000)}s`
          : `az monitor log-analytics query --workspace "${result.workspace_id}" --analytics-query "<azure_query>"`
      ]
    };
  }

  const post = options.postJson || postJson;
  const response = await post(`${endpoint}/v1/traces`, otlpAttributionSmokeTracePayload(id, options.nowMs), options);
  let verification = null;
  if (response.ok && verify) {
    verification = await verifySmokeInAzure(id, {
      ...options,
      last,
      waitMs,
      pollMs
    });
  }
  const ok = response.ok && (!verify || verification?.ok === true);
  return {
    ...result,
    ok,
    collector_response: response,
    verification,
    next: response.ok
      ? (verification?.ok
          ? [
              `Verified ${verification.rows} attribution smoke row${verification.rows === 1 ? '' : 's'} in Log Analytics.`,
              'node agentops-cli/src/index.js attribution --last 2h',
              'node agentops-cli/src/index.js mcp --last 2h',
              'node agentops-cli/src/index.js lineage --last 2h'
            ]
          : [
              verify
                ? `Attribution smoke was sent, but Log Analytics did not return ${id} before the wait expired.`
                : `Run this Azure query after ingestion latency settles: ${query}`,
              'node agentops-cli/src/index.js validate-azure'
            ])
      : ['Start the collector with `node agentops-cli/src/index.js collector start` or `./scripts/collector-azuremonitor-up.sh`.']
  };
}

async function agentopsLiveReplaySmoke(options = {}) {
  const endpoint = (options.endpoint || otlpHttpEndpoint).replace(/\/$/, '');
  const id = options.id || liveReplaySmokeId(options.now);
  const last = validateKqlDuration(options.last || '2h');
  const query = smokeAzureQuery(id, last);
  const waitMs = durationToMs(options.waitMs ?? options.wait, 60000);
  const pollMs = durationToMs(options.pollMs ?? options.poll, 10000);
  const verify = options.verify !== false;
  const grafanaUrl = liveReplayGrafanaUrl(id, last, options);
  const result = {
    smoke_kind: 'live-replay',
    smoke_id: id,
    endpoint,
    dry_run: Boolean(options.dryRun),
    verify,
    wait_ms: waitMs,
    poll_ms: pollMs,
    workspace_id: options.workspaceId || options.defaultWorkspaceId,
    azure_query: query,
    grafana_url: grafanaUrl,
    payload_preview: {
      service: 'github-copilot-cli',
      operation: 'live_replay_smoke',
      agent: 'agentops-orchestrator-smoke',
      subagent: 'agentops-investigator-smoke',
      delegation_id: `${id}-delegation-1`,
      skill: 'agentops-live-triage',
      mcp_server: 'azure-mcp',
      script: 'pre-tool-policy',
      content_capture_enabled: false
    }
  };

  if (options.dryRun) {
    return {
      ...result,
      ok: true,
      next: [
        `POST ${endpoint}/v1/traces`,
        grafanaUrl,
        verify
          ? `node agentops-cli/src/index.js live-replay-smoke --id ${id} --wait ${Math.ceil(waitMs / 1000)}s --poll ${Math.ceil(pollMs / 1000)}s`
          : `az monitor log-analytics query --workspace "${result.workspace_id}" --analytics-query "<azure_query>"`
      ]
    };
  }

  const post = options.postJson || postJson;
  const response = await post(`${endpoint}/v1/traces`, otlpLiveReplaySmokeTracePayload(id, options.nowMs), options);
  let verification = null;
  if (response.ok && verify) {
    verification = await verifySmokeInAzure(id, {
      ...options,
      last,
      waitMs,
      pollMs
    });
  }
  const ok = response.ok && (!verify || verification?.ok === true);
  return {
    ...result,
    ok,
    collector_response: response,
    verification,
    next: response.ok
      ? (verification?.ok
          ? [
              `Verified ${verification.rows} live replay smoke rows in Log Analytics.`,
              grafanaUrl,
              'node agentops-cli/src/index.js lineage --last 2h'
            ]
          : [
              verify
                ? `Live replay smoke was sent, but Log Analytics did not return ${id} before the wait expired.`
                : `Run this Azure query after ingestion latency settles: ${query}`,
              grafanaUrl
            ])
      : ['Start the collector with `node agentops-cli/src/index.js collector start` or `./scripts/collector-azuremonitor-up.sh`.']
  };
}

function createSmokeContext(dependencies = {}) {
  const {
    defaultWorkspaceId,
    grafanaBaseUrl,
    latestSummaryFromArgs,
    openLinksSummary,
    runAzureLogAnalyticsQuery,
    sleep
  } = dependencies;
  const smoke = agentopsSmoke;
  const attributionSmoke = agentopsAttributionSmoke;
  const liveReplaySmoke = agentopsLiveReplaySmoke;
  const azureSmokeVerification = verifySmokeInAzure;

  return {
    agentopsSmoke(options = {}) {
      return smoke({
        defaultWorkspaceId,
        runAzureLogAnalyticsQuery,
        latestSummaryFromArgs: latestSummaryFromArgs ? ({ last }) => latestSummaryFromArgs(['--last', last], last) : undefined,
        openLinksSummary,
        sleep,
        ...options
      });
    },
    agentopsAttributionSmoke(options = {}) {
      return attributionSmoke({
        defaultWorkspaceId,
        runAzureLogAnalyticsQuery,
        ...options
      });
    },
    agentopsLiveReplaySmoke(options = {}) {
      return liveReplaySmoke({
        defaultWorkspaceId,
        grafanaBaseUrl,
        runAzureLogAnalyticsQuery,
        ...options
      });
    },
    verifySmokeInAzure(id, options = {}) {
      return azureSmokeVerification(id, {
        defaultWorkspaceId,
        runAzureLogAnalyticsQuery,
        ...options
      });
    }
  };
}

function renderSmoke(result) {
  const lines = [
    result.smoke_kind === 'live-replay'
      ? 'AgentOps live replay smoke'
      : (result.smoke_kind === 'attribution'
          ? 'AgentOps attribution smoke'
          : 'AgentOps smoke'),
    '',
    `Smoke id: ${result.smoke_id}`,
    `Endpoint: ${result.endpoint}`,
    `Mode: ${result.dry_run ? 'dry-run' : 'sent'}`
  ];

  if (result.collector_response) {
    lines.push(result.collector_response.ok
      ? `Collector response: ${result.collector_response.statusCode || 'ok'}.`
      : `Collector response: failed (${result.collector_response.error || result.collector_response.statusCode || 'unknown'}).`);
  }

  if (result.copilot_run) {
    lines.push(result.copilot_run.ok
      ? `Real Copilot smoke: completed in ${result.copilot_run.duration_ms}ms.`
      : `Real Copilot smoke: failed (${result.copilot_run.error || result.copilot_run.signal || `exit ${result.copilot_run.status}`}).`);
  } else if (result.real_copilot && result.dry_run) {
    lines.push(`Real Copilot smoke: planned (${result.copilot_command}).`);
  }

  if (result.latest_visibility) {
    lines.push(result.latest_visibility.ok
      ? `Latest Copilot run: visible after ${result.latest_visibility.attempts.length} attempt${result.latest_visibility.attempts.length === 1 ? '' : 's'}.`
      : `Latest Copilot run: ${result.latest_visibility.status.replace(/_/g, ' ')} after ${result.latest_visibility.attempts.length} attempt${result.latest_visibility.attempts.length === 1 ? '' : 's'}.`);
  }

  if (result.verification) {
    lines.push(result.verification.ok
      ? `Azure verification: found ${result.verification.rows} row${result.verification.rows === 1 ? '' : 's'} after ${result.verification.attempts.length} attempt${result.verification.attempts.length === 1 ? '' : 's'}.`
      : `Azure verification: ${result.verification.status.replace(/_/g, ' ')} after ${result.verification.attempts.length} attempt${result.verification.attempts.length === 1 ? '' : 's'}.`);
  } else if (!result.dry_run && result.verify === false) {
    lines.push('Azure verification: skipped.');
  }

  if (result.links?.primary_investigation_url) {
    lines.push(`${result.links.primary_investigation_label || 'Primary investigation'}: ${result.links.primary_investigation_url}`);
  }
  if (result.grafana_url) {
    lines.push(`Grafana Live Replay: ${result.grafana_url}`);
  }
  if (result.links?.v2_replay_url && result.links.v2_replay_url !== result.links.primary_investigation_url) {
    lines.push(`Run Story: ${result.links.v2_replay_url}`);
  }
  if (result.browser_open) {
    lines.push(result.browser_open.ok
      ? `Browser open: opened Run Story.`
      : `Browser open: failed (${result.browser_open.error || result.browser_open.status || result.browser_open.reason || 'unknown'}).`);
  }
  lines.push('', 'Azure verification query:', result.azure_query, '', 'Next:');
  for (const item of result.next || []) lines.push(`- ${item}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  agentopsAttributionSmoke,
  agentopsLiveReplaySmoke,
  agentopsSmoke,
  attributionSmokeId,
  commandShellQuote,
  createSmokeContext,
  liveReplayGrafanaUrl,
  liveReplaySmokeId,
  openUrlInBrowser,
  otlpAttributionSmokeTracePayload,
  otlpLiveReplaySmokeTracePayload,
  otlpSmokeTracePayload,
  parseSmokeArgs,
  postJson,
  realCopilotSmokeArgs,
  realCopilotSmokeCommand,
  renderSmoke,
  runRealCopilotSmoke,
  smokeAzureQuery,
  smokeId,
  verifySmokeInAzure,
  waitForLatestRunSummary
};
