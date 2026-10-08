const { formatCostTotal, formatUsd } = require('../cost-estimate');
const { OUTCOME_LABELS, attentionText } = require('../copilot/run-status');

function compactNumber(value) {
  const number = Number(value || 0);
  const abs = Math.abs(number);
  if (abs >= 1e9) return `${(number / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(number / 1e3).toFixed(0)}k`;
  if (abs >= 1e3) return `${(number / 1e3).toFixed(1)}k`;
  return String(Math.round(number * 100) / 100);
}

function percent(rate) {
  return rate === null || rate === undefined ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
}

// Round at the displayed precision before picking the unit, so 59,999 ms is
// "1.0 min" rather than "60.0 s".
function duration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return 'n/a';
  const wholeMs = Math.round(ms);
  if (wholeMs < 1000) return `${wholeMs} ms`;
  const tenthsOfSecond = Math.round(ms / 100);
  if (tenthsOfSecond < 600) return `${(tenthsOfSecond / 10).toFixed(1)} s`;
  const tenthsOfMinute = Math.round(ms / 6000);
  if (tenthsOfMinute < 600) return `${(tenthsOfMinute / 10).toFixed(1)} min`;
  return `${(Math.round(ms / 360000) / 10).toFixed(1)} h`;
}

function usd(value) {
  const amount = formatUsd(value);
  return amount === 'n/a' ? amount : `${amount} est.`;
}

function costLabel(tokens) {
  return formatCostTotal({ costUsd: tokens.estCostUsd, unpricedModels: tokens.unpricedModels || [] });
}

function day(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

function stamp(iso) {
  return iso ? String(iso).slice(0, 16).replace('T', ' ') : '';
}

function shortId(id) {
  return String(id || '').length > 24 ? `${String(id).slice(0, 24)}…` : String(id || '');
}

// Returns { text, direction } where direction is 'up', 'down' or 'flat';
// withTone() then says whether that direction is good for the metric.
function trendText(trend, format = 'count') {
  if (!trend || trend.current === null || trend.current === undefined || trend.previous === null || trend.previous === undefined) return { text: 'no previous data', direction: 'flat' };
  const { delta, pctChange, kind } = trend;
  if (delta === 0) return { text: 'no change', direction: 'flat' };
  const arrow = delta > 0 ? '▲' : '▼';
  let text;
  if (kind === 'rate') text = `${arrow} ${Math.abs(delta * 100).toFixed(1)} pts`;
  else if (format === 'usd') text = `${arrow} $${Math.abs(delta).toFixed(2)}${pctChange === null ? '' : ` (${Math.round(Math.abs(pctChange) * 100)}%)`}`;
  else text = `${arrow} ${compactNumber(Math.abs(delta))}${pctChange === null ? ' (new)' : ` (${Math.round(Math.abs(pctChange) * 100)}%)`}`;
  return { text, direction: delta > 0 ? 'up' : 'down' };
}

function withTone(result, higherIsBetter) {
  if (result.direction === 'flat' || higherIsBetter === null) return { ...result, tone: 'neutral' };
  const good = (result.direction === 'up') === higherIsBetter;
  return { ...result, tone: good ? 'good' : 'bad' };
}

function glanceRows(digest) {
  const { current, previous, trend } = digest;
  return [
    {
      metric: 'Sessions',
      now: String(current.sessions),
      before: String(previous.sessions),
      change: withTone(trendText(trend.sessions), null)
    },
    {
      metric: 'Clean sessions',
      now: `${percent(current.sessionSuccessRate)} (${current.cleanSessions}/${current.sessions})`,
      before: percent(previous.sessionSuccessRate),
      change: withTone(trendText(trend.sessionSuccessRate), true),
      hint: `${current.sessionsWithFailures} with failures, ${current.sessionsNeedingAttention || 0} need attention, ${current.abortedSessions} aborted`
    },
    {
      metric: OUTCOME_LABELS.failedToolCalls,
      now: `${compactNumber(current.failedToolCalls)} of ${compactNumber(current.toolCalls)} (${percent(current.toolFailureRate)})`,
      before: `${compactNumber(previous.failedToolCalls)} (${percent(previous.toolFailureRate)})`,
      change: withTone(trendText(trend.toolFailureRate), false),
      hint: 'tool calls that returned an error; denials and non-zero exits are counted under Needs attention'
    },
    {
      metric: OUTCOME_LABELS.attention,
      now: attentionText({ denials: current.deniedToolCalls || 0, nonZeroExits: current.nonZeroExitToolCalls || 0 }),
      before: attentionText({ denials: previous.deniedToolCalls || 0, nonZeroExits: previous.nonZeroExitToolCalls || 0 }),
      change: withTone(trendText(trend.attentionToolCalls), false)
    },
    {
      metric: 'Tokens',
      now: compactNumber(current.tokens.totalTokens),
      before: compactNumber(previous.tokens.totalTokens),
      change: withTone(trendText(trend.totalTokens), null),
      hint: current.tokens.sessionsWithoutTokens ? `${current.tokens.sessionsWithoutTokens} session(s) reported no usage` : ''
    },
    {
      metric: 'Cost',
      now: costLabel(current.tokens),
      before: costLabel(previous.tokens),
      change: withTone(trendText(trend.estCostUsd, 'usd'), false),
      hint: [
        current.tokens.premiumRequests === null ? '' : `${compactNumber(current.tokens.premiumRequests)} premium requests reported by Copilot`
      ].filter(Boolean).join('; ')
    }
  ];
}

function listPreview(items = [], limit = 5) {
  if (!items.length) return 'unknown';
  const extra = items.length - limit;
  return extra > 0 ? `${items.slice(0, limit).join(', ')} +${extra} more` : items.join(', ');
}

module.exports = {
  compactNumber,
  costLabel,
  day,
  duration,
  glanceRows,
  listPreview,
  percent,
  shortId,
  stamp,
  trendText,
  usd
};
