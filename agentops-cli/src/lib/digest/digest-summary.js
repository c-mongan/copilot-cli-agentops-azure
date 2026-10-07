const { clusterFailures } = require('./failure-clusters');
const { estimateModelCostUsd, estimateUsageCost, formatCostTotal } = require('../cost-estimate');

const DAY_MS = 24 * 60 * 60 * 1000;

function parsePeriod(value = '7d') {
  const match = String(value).trim().match(/^([1-9][0-9]{0,3})(h|d|w)$/);
  if (!match) throw new Error('--since must look like 24h, 7d or 2w');
  const amount = Number(match[1]);
  const unitMs = { h: 60 * 60 * 1000, d: DAY_MS, w: 7 * DAY_MS }[match[2]];
  const periodMs = amount * unitMs;
  if (periodMs > 365 * DAY_MS) throw new Error('--since cannot exceed 365d');
  return { label: `${amount}${match[2]}`, periodMs };
}

function periodWindows(nowMs, periodMs) {
  return {
    current: { startMs: nowMs - periodMs, endMs: nowMs },
    previous: { startMs: nowMs - 2 * periodMs, endMs: nowMs - periodMs }
  };
}

// Half-open windows [start, end) so a session lands in exactly one period;
// the current window includes "now".
function inWindow(iso, window, inclusiveEnd = false) {
  const time = Date.parse(iso || '');
  if (!Number.isFinite(time)) return false;
  return time >= window.startMs && (inclusiveEnd ? time <= window.endMs : time < window.endMs);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

// Tools whose duration is time spent waiting for a person or polling other
// work, not tool latency; they would otherwise dominate every p95 ranking.
const WAIT_TOOLS = new Set(['ask_user', 'exit_plan_mode', 'read_agent', 'read_bash', 'read_powershell', 'write_agent']);

function slowestTools(sessions, { limit = 5, minCalls = 3 } = {}) {
  const byTool = new Map();
  for (const session of sessions) {
    for (const { tool, ms } of session.toolDurations || []) {
      if (WAIT_TOOLS.has(tool)) continue;
      const list = byTool.get(tool) || [];
      list.push(ms);
      byTool.set(tool, list);
    }
  }
  let rows = [...byTool.entries()].map(([tool, values]) => ({
    tool,
    calls: values.length,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: Math.max(...values)
  }));
  const frequent = rows.filter(row => row.calls >= minCalls);
  if (frequent.length) rows = frequent;
  return rows.sort((left, right) => right.p95Ms - left.p95Ms || left.tool.localeCompare(right.tool)).slice(0, limit);
}

function costStatusOf(modelCount, pricedCount, unpricedCount) {
  if (!modelCount || !pricedCount) return 'unavailable';
  return unpricedCount ? 'partial' : 'estimated';
}

function tokenTotals(sessions, priceTable = {}) {
  const byModel = Object.create(null);
  let premiumRequests = 0;
  let premiumObserved = false;
  let sessionsWithoutTokens = 0;
  for (const session of sessions) {
    if (Number.isFinite(session.premiumRequests)) {
      premiumRequests += session.premiumRequests;
      premiumObserved = true;
    }
    const models = Object.entries(session.tokensByModel || {});
    if (!models.length) sessionsWithoutTokens += 1;
    for (const [model, usage] of models) {
      const entry = byModel[model] || { model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, sessions: 0 };
      entry.inputTokens += usage.inputTokens || 0;
      entry.outputTokens += usage.outputTokens || 0;
      entry.cacheReadTokens += usage.cacheReadTokens || 0;
      entry.cacheWriteTokens += usage.cacheWriteTokens || 0;
      entry.sessions += 1;
      byModel[model] = entry;
    }
  }
  const models = Object.values(byModel).map(entry => {
    const cost = estimateModelCostUsd(entry.model, entry, priceTable);
    return { ...entry, totalTokens: entry.inputTokens + entry.outputTokens, estCostUsd: cost };
  }).sort((left, right) => right.totalTokens - left.totalTokens || left.model.localeCompare(right.model));
  // Same estimator and per-model merge as `agentops ui`, so both show one total.
  const { costUsd: estCostUsd, pricedModels, unpricedModels: unpriced } = estimateUsageCost(byModel, priceTable);
  const priced = pricedModels;
  const unpricedModels = models.map(entry => entry.model).filter(model => unpriced.includes(model));
  return {
    models,
    inputTokens: models.reduce((sum, entry) => sum + entry.inputTokens, 0),
    outputTokens: models.reduce((sum, entry) => sum + entry.outputTokens, 0),
    totalTokens: models.reduce((sum, entry) => sum + entry.totalTokens, 0),
    estCostUsd,
    costStatus: costStatusOf(models.length, priced.length, unpricedModels.length),
    costLabel: formatCostTotal({ costUsd: estCostUsd, unpricedModels }),
    unpricedModels,
    premiumRequests: premiumObserved ? Math.round(premiumRequests * 100) / 100 : null,
    sessionsWithoutTokens
  };
}

function periodMetrics(sessions, priceTable) {
  const toolCalls = sessions.reduce((sum, session) => sum + session.toolCalls, 0);
  const failedToolCalls = sessions.reduce((sum, session) => sum + session.failedToolCalls, 0);
  const aborted = sessions.filter(session => session.aborted).length;
  const withFailures = sessions.filter(session => session.failedToolCalls > 0).length;
  const clean = sessions.filter(session => !session.aborted && session.failedToolCalls === 0).length;
  return {
    sessions: sessions.length,
    cleanSessions: clean,
    sessionsWithFailures: withFailures,
    abortedSessions: aborted,
    sessionSuccessRate: sessions.length ? clean / sessions.length : null,
    toolCalls,
    failedToolCalls,
    toolFailureRate: toolCalls ? failedToolCalls / toolCalls : null,
    tokens: tokenTotals(sessions, priceTable)
  };
}

function trendValue(current, previous, kind = 'count') {
  const known = current !== null && current !== undefined && previous !== null && previous !== undefined;
  const delta = known ? current - previous : null;
  let pctChange = null;
  // A rise from zero has no meaningful percentage; it is reported as new.
  if (known && kind === 'count' && previous !== 0) pctChange = delta / previous;
  else if (known && kind === 'count' && current === 0) pctChange = 0;
  return { current: current ?? null, previous: previous ?? null, delta, pctChange, kind };
}

function trendBetween(current, previous) {
  return {
    sessions: trendValue(current.sessions, previous.sessions),
    sessionSuccessRate: trendValue(current.sessionSuccessRate, previous.sessionSuccessRate, 'rate'),
    failedToolCalls: trendValue(current.failedToolCalls, previous.failedToolCalls),
    toolFailureRate: trendValue(current.toolFailureRate, previous.toolFailureRate, 'rate'),
    totalTokens: trendValue(current.tokens.totalTokens, previous.tokens.totalTokens),
    estCostUsd: trendValue(current.tokens.estCostUsd, previous.tokens.estCostUsd)
  };
}

const ERROR_TYPE_WEIGHT = { denied: 3, timeout: 3, rate_limited: 3, blocked: 2, unknown_tool: 2, nonzero_exit: 0.5 };

// One action per tool + error type, even when it failed under several models.
function actionGroups(clusters) {
  const groups = new Map();
  for (const cluster of clusters) {
    const key = `${cluster.tool}|${cluster.errorType}`;
    const group = groups.get(key) || { lead: cluster, count: 0, runs: new Set() };
    group.count += cluster.count;
    for (const run of cluster.runs) group.runs.add(run);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function formatSeconds(ms) {
  return ms >= 10000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`;
}

function recommendations({ current, trend, clusters, tools, sessions }) {
  const candidates = [];
  if (!sessions.length) {
    candidates.push({ score: 100, kind: 'setup', text: 'No Copilot CLI sessions in this period. Run `agentops copilot -p "<task>"` or check COPILOT_HOME, then run the digest again.' });
  }
  for (const { lead, count, runs } of actionGroups(clusters.clusters)) {
    candidates.push({
      score: count * (ERROR_TYPE_WEIGHT[lead.errorType] || 1.5) * Math.max(1, runs.size),
      kind: 'failure-cluster',
      clusterId: lead.id,
      title: `${lead.tool} ${lead.errorType}`,
      detail: `${count}x in ${runs.size} run${runs.size === 1 ? '' : 's'}`,
      body: lead.suggestedNextStep,
      text: `${lead.tool} ${lead.errorType} (${count}x in ${runs.size} run${runs.size === 1 ? '' : 's'}): ${lead.suggestedNextStep}`
    });
  }
  const rateTrend = trend.toolFailureRate;
  if (rateTrend.delta !== null && rateTrend.delta >= 0.02 && current.failedToolCalls >= 3) {
    candidates.push({
      score: 40 + rateTrend.delta * 1000,
      kind: 'trend',
      text: `Tool failure rate rose from ${(rateTrend.previous * 100).toFixed(1)}% to ${(rateTrend.current * 100).toFixed(1)}%. Start with the largest cluster above.`
    });
  }
  const slow = tools.find(tool => tool.p95Ms >= 30000);
  if (slow) {
    candidates.push({
      score: 20 + slow.p95Ms / 10000,
      kind: 'latency',
      text: `${slow.tool} is the slowest tool (p95 ${formatSeconds(slow.p95Ms)} over ${slow.calls} calls); narrow its scope or run it in the background.`
    });
  }
  if (current.tokens.unpricedModels.length) {
    candidates.push({
      score: 5,
      kind: 'cost',
      text: `No price is known for ${current.tokens.unpricedModels.slice(0, 3).join(', ')}${current.tokens.unpricedModels.length > 3 ? ' and others' : ''}; pass --prices <file.json> to estimate their cost.`
    });
  }
  if (candidates.length === 0) {
    candidates.push({ score: 1, kind: 'healthy', text: 'No failures this period. Keep strict privacy on and compare next week\'s digest for drift.' });
  }
  return candidates
    .sort((left, right) => right.score - left.score || left.text.localeCompare(right.text))
    .slice(0, 3)
    .map(candidate => {
      const action = { ...candidate };
      delete action.score;
      return action;
    });
}

function buildDigest({ sessions = [], nowMs = Date.now(), period = parsePeriod('7d'), prices = { table: {}, label: '' }, sources = {} } = {}) {
  const windows = periodWindows(nowMs, period.periodMs);
  const currentSessions = sessions.filter(session => inWindow(session.startedAt, windows.current, true));
  const previousSessions = sessions.filter(session => inWindow(session.startedAt, windows.previous));
  const current = periodMetrics(currentSessions, prices.table);
  const previous = periodMetrics(previousSessions, prices.table);
  const failures = currentSessions.flatMap(session => session.failures || []);
  const clusters = clusterFailures(failures);
  const tools = slowestTools(currentSessions);
  const trend = trendBetween(current, previous);
  return {
    ok: true,
    schema: 'agentops.digest.v1',
    privacy: 'metadata-only',
    generatedAt: new Date(nowMs).toISOString(),
    period: {
      label: period.label,
      start: new Date(windows.current.startMs).toISOString(),
      end: new Date(windows.current.endMs).toISOString(),
      previousStart: new Date(windows.previous.startMs).toISOString(),
      previousEnd: new Date(windows.previous.endMs).toISOString()
    },
    sources,
    current,
    previous,
    trend,
    failureClusters: clusters,
    slowestTools: tools,
    priceTable: prices.label,
    recommendations: recommendations({ current, trend, clusters, tools, sessions: currentSessions })
  };
}

module.exports = {
  WAIT_TOOLS,
  buildDigest,
  inWindow,
  parsePeriod,
  percentile,
  periodMetrics,
  periodWindows,
  slowestTools,
  tokenTotals,
  trendBetween,
  trendValue
};
