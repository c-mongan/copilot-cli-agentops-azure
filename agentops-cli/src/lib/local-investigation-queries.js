const path = require('node:path');

const { agentopsHome: defaultAgentopsHome } = require('./paths');
const { readSessionOutbox } = require('./copilot/session-delivery-outbox');
const { defaultSessionEventsPath, readCopilotSessionEvents } = require('./copilot/session-enricher');
const { readSessionSpanRows, enrichSpansWithSessionToolContext } = require('./copilot/session-span-export');
const { sessionWaterfall } = require('./copilot/session-waterfall');
const { safeMetadataValue } = require('./safe-metadata');
const { loadLedgerFromDirectory } = require('./architecture-command');
const { buildStaticGraph, joinLedger } = require('./architecture/graph');
const { scriptHealth, toolRepetition, skillCoactivation } = require('./architecture/metrics');

const RUN_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

// --- Canned question: "read order in failed run" -------------------------
//
// Answered entirely from the LOCAL run/session ledger — no KQL, no Azure
// round trip, and no new ordering logic. It resolves run id -> session id
// using the same delivery-outbox convention `copilot-session view`/
// `export-*` already write under `<AGENTOPS_HOME>/runs/<runId>/outbox.json`
// (see session-delivery-outbox.js), reads the native Copilot session-state
// event ledger at `<COPILOT_HOME>/session-state/<sessionId>/events.jsonl`
// (session-enricher.js's existing path convention), optionally joins any
// locally exported native/script spans the same way `copilot-session view`
// does, and hands everything to Task 2's `sessionWaterfall()` for ordering.
function safeTimelineRow(row) {
  return {
    index: row.index,
    start: row.start,
    end: row.end,
    lane: safeMetadataValue(row.lane) || '',
    kind: safeMetadataValue(row.kind) || '',
    label: safeMetadataValue(row.label) || '',
    status: safeMetadataValue(row.status) || '',
    source: safeMetadataValue(row.source) || ''
  };
}

function readOrderQuery(runId, options = {}) {
  const safeRunId = String(runId || '');
  if (!RUN_ID_PATTERN.test(safeRunId)) {
    return {
      ok: false,
      question: 'read-order',
      run_id: safeRunId,
      error: 'read-order requires a safe run id (letters, digits, and _.:- only, max 128 chars).'
    };
  }
  const agentopsHomeDir = options.agentopsHome || defaultAgentopsHome;
  const runDirectory = path.join(agentopsHomeDir, 'runs', safeRunId);
  let sessionId = options.sessionId || null;
  if (!sessionId) {
    const readSessionOutboxFn = options.readSessionOutbox || readSessionOutbox;
    let outbox = null;
    try {
      outbox = readSessionOutboxFn(runDirectory);
    } catch (error) {
      return { ok: false, question: 'read-order', run_id: safeRunId, error: `Local delivery state for run ${safeRunId} is unreadable: ${error.message}` };
    }
    sessionId = outbox?.sessionId || null;
  }
  if (!sessionId) {
    return {
      ok: false,
      question: 'read-order',
      run_id: safeRunId,
      error: `No local session id resolved for run ${safeRunId}. Expected a delivery outbox at ${path.join(runDirectory, 'outbox.json')} (written by copilot-session view/export-*), or pass an explicit session id.`
    };
  }
  const defaultSessionEventsPathFn = options.defaultSessionEventsPath || defaultSessionEventsPath;
  const readCopilotSessionEventsFn = options.readCopilotSessionEvents || readCopilotSessionEvents;
  const eventsFile = options.eventsFile || defaultSessionEventsPathFn(sessionId);
  let events;
  try {
    events = readCopilotSessionEventsFn(eventsFile);
  } catch (error) {
    return { ok: false, question: 'read-order', run_id: safeRunId, session_id: sessionId, error: `No local session events were found at ${eventsFile}: ${error.message}` };
  }
  const readSessionSpanRowsFn = options.readSessionSpanRows || readSessionSpanRows;
  const enrichSpansFn = options.enrichSpansWithSessionToolContext || enrichSpansWithSessionToolContext;
  let nativeSpans = [];
  try {
    const exported = readSessionSpanRowsFn(runDirectory, safeRunId, sessionId);
    nativeSpans = enrichSpansFn(exported.spans || [], events);
  } catch {
    // Exported native/script spans are optional supporting evidence; their
    // absence (or an unreadable export) should not block the session-event
    // ordering itself, only narrow the joins sessionWaterfall can make.
    nativeSpans = [];
  }
  const sessionWaterfallFn = options.sessionWaterfall || sessionWaterfall;
  const waterfall = sessionWaterfallFn(events, nativeSpans, { repoRoot: options.repoRoot });
  const failedRows = waterfall.rows.filter(row => row.status === 'failed' || (typeof row.status === 'string' && row.status.includes('not observed')));
  return {
    ok: true,
    question: 'read-order',
    run_id: safeRunId,
    session_id: sessionId,
    row_count: waterfall.rows.length,
    failed_row_count: failedRows.length,
    coverage_gaps: waterfall.coverageGaps,
    timeline: waterfall.rows.map(safeTimelineRow)
  };
}

// --- Canned questions backed by Task 6's architecture engine --------------
//
// These three read the SAME `--ledger <dir>` architecture ledger (an
// attachment.json manifest plus per-run events.jsonl/context.json, exactly
// what `agentops architecture` reads via loadLedgerFromDirectory) and call
// its metrics functions directly — scriptHealth/toolRepetition/
// skillCoactivation — rather than recomputing proportions or evidence rules.
// Each renders a short, focused top-N answer instead of the full report.
function loadMetricsLedger(ledgerDir, options = {}) {
  const loadLedgerFromDirectoryFn = options.loadLedgerFromDirectory || loadLedgerFromDirectory;
  const { attachment, runs, invalidLedgerRows } = loadLedgerFromDirectoryFn(ledgerDir);
  const graph = buildStaticGraph(attachment.architecture);
  const normalisedRuns = runs.map(run => ({ ...run, architectureVersion: run.architectureVersion || graph.architectureVersion }));
  const { joined, invalid } = joinLedger(graph, normalisedRuns);
  return { graph, joined, invalidLedgerRows: invalidLedgerRows + invalid.length };
}

function topN(options = {}) {
  return Number.isInteger(options.top) && options.top > 0 ? options.top : 3;
}

function slowScriptsQuery(ledgerDir, options = {}) {
  const { graph, joined, invalidLedgerRows } = loadMetricsLedger(ledgerDir, options);
  const rows = scriptHealth(graph, joined);
  const ranked = [...rows]
    .filter(row => Number.isFinite(row.p95DurationMs))
    .sort((a, b) => b.p95DurationMs - a.p95DurationMs)
    .slice(0, topN(options));
  return {
    ok: true,
    question: 'slow-scripts',
    architecture_version: graph.architectureVersion,
    coverage_runs: rows[0]?.coverageRuns ?? 0,
    invalid_ledger_rows: invalidLedgerRows,
    scripts: ranked.map(row => ({
      script: row.script,
      calls: row.calls,
      runs: row.runs,
      failure_rate: row.failureRate,
      p50_duration_ms: row.p50DurationMs,
      p95_duration_ms: row.p95DurationMs
    }))
  };
}

function repeatedToolsQuery(ledgerDir, options = {}) {
  const { graph, joined, invalidLedgerRows } = loadMetricsLedger(ledgerDir, options);
  const rows = toolRepetition(graph, joined);
  const ranked = [...rows].sort((a, b) => (b.rate || 0) - (a.rate || 0)).slice(0, topN(options));
  return {
    ok: true,
    question: 'repeated-tools',
    architecture_version: graph.architectureVersion,
    coverage_runs: rows[0]?.denominator ?? 0,
    invalid_ledger_rows: invalidLedgerRows,
    tools: ranked.map(row => ({
      tool: row.tool,
      thrash_triggered: row.numerator,
      coverage_runs: row.denominator,
      thrash_rate: row.rate,
      confirmed_by_state_count: row.confirmedByStateCount,
      status: row.status,
      representative_run_ids: row.representativeRunIds
    }))
  };
}

function coActivationQuery(ledgerDir, options = {}) {
  const { graph, joined, invalidLedgerRows } = loadMetricsLedger(ledgerDir, options);
  const rows = skillCoactivation(graph, joined);
  const ranked = [...rows]
    .sort((a, b) => Math.max(b.pBGivenA.rate || 0, b.pAGivenB.rate || 0) - Math.max(a.pBGivenA.rate || 0, a.pAGivenB.rate || 0))
    .slice(0, topN(options));
  return {
    ok: true,
    question: 'co-activation',
    architecture_version: graph.architectureVersion,
    coverage_runs: rows[0]?.pBGivenA?.coverageRuns ?? 0,
    invalid_ledger_rows: invalidLedgerRows,
    pairs: ranked.map(row => ({
      skill_a: row.skillA,
      skill_b: row.skillB,
      p_b_given_a: row.pBGivenA.rate,
      p_a_given_b: row.pAGivenB.rate,
      status_a_given_b: row.pAGivenB.status,
      status_b_given_a: row.pBGivenA.status,
      representative_run_ids: row.representativeRunIds
    }))
  };
}

module.exports = {
  coActivationQuery,
  loadMetricsLedger,
  readOrderQuery,
  repeatedToolsQuery,
  slowScriptsQuery
};
