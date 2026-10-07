#!/usr/bin/env node
// Builds grafana/agentops-copilot-cli.json: one portable dashboard for the
// verified Log Analytics data path (AgentOpsEvents_CL, AgentOpsSpans_CL,
// AgentOpsRunSummary_CL). It uses only the built-in Azure Monitor datasource
// through ${datasource}/${subscription}/${workspace} variables, so the same
// JSON imports into Azure Monitor dashboards with Grafana, Azure Managed
// Grafana and self-hosted Grafana without edits.
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const outFile = path.join(repoRoot, 'grafana', 'agentops-copilot-cli.json');

const DATASOURCE_TYPE = 'grafana-azure-monitor-datasource';
const datasource = { type: DATASOURCE_TYPE, uid: '${datasource}' };
const PRICE_IN_VAR = 'est_price_in_usd_per_mtok';
const PRICE_OUT_VAR = 'est_price_out_usd_per_mtok';
const DEFAULT_PRICE_IN = '3';
const DEFAULT_PRICE_OUT = '15';

// Shared KQL building blocks. Every panel repeats the lets it needs because
// Azure Monitor panels cannot share query fragments.
const base = `let _from = $__timeFrom();
let _to = $__timeTo();
let Ev = AgentOpsEvents_CL
| where TimeGenerated between (_from .. _to) and isnotempty(RunId)
| extend DedupKey = iff(isempty(EventId), strcat(RunId, "|", EventName, "|", ToolCallId, "|", tostring(Sequence), "|", tostring(TimeGenerated)), EventId)
| summarize arg_max(TimeGenerated, *) by DedupKey;
let Sp = AgentOpsSpans_CL
| where TimeGenerated between (_from .. _to) and isnotempty(RunId)
| summarize arg_max(TimeGenerated, *) by RunId, SpanId, OperationName;
let Rs = AgentOpsRunSummary_CL
| where TimeGenerated between (_from .. _to) and isnotempty(RunId)
| summarize arg_max(TimeGenerated, *) by RunId;`;

const tools = `let ToolEv = Ev
| where EventName in ("tool.execution_start", "tool.execution_complete") and isnotempty(ToolCallId)
| summarize StartedAt = minif(TimeGenerated, EventName == "tool.execution_start"), EndedAt = maxif(TimeGenerated, EventName == "tool.execution_complete"), Status = take_anyif(Status, EventName == "tool.execution_complete"), ToolName = take_anyif(ToolName, isnotempty(ToolName)) by RunId, ToolCallId
| where isnotnull(EndedAt)
| project RunId, ToolCallId, ToolName, LatencyMs = iff(isnull(StartedAt), real(null), todouble(datetime_diff("millisecond", EndedAt, StartedAt))), Failed = Status in~ ("failed", "error", "denied", "blocked");
let ToolSp = Sp
| where OperationName == "execute_tool"
| join kind=leftanti (ToolEv | project RunId, ToolCallId) on RunId, ToolCallId
| project RunId, ToolCallId, ToolName, LatencyMs = todouble(DurationMs), Failed = Outcome in~ ("failed", "error");
let ToolLegacy = Ev
| where EventName in ("tool.call", "mcp.tools.call")
| project RunId, ToolCallId, ToolName = coalesce(ToolName, McpToolName), LatencyMs = iff(DurationMs > 0, todouble(DurationMs), real(null)), Failed = Status in~ ("failed", "error", "denied", "blocked");
let Tools = union ToolEv, ToolSp, ToolLegacy
| extend ToolName = iff(isempty(ToolName), "(unknown)", ToolName);`;

// agentops.event span rows are stamped at the event time but copy the parent
// span's DurationMs, so they must not extend the run window.
const runs = `let Runs = union
    (Ev | project RunId, SessionId, StartedAt = TimeGenerated, EndedAt = TimeGenerated),
    (Sp | project RunId, SessionId, StartedAt = TimeGenerated, EndedAt = iff(OperationName == "agentops.event", TimeGenerated, TimeGenerated + coalesce(DurationMs, 0) * 1ms)),
    (Rs | project RunId, SessionId, StartedAt = TimeGenerated, EndedAt = TimeGenerated)
| summarize SessionId = take_anyif(SessionId, isnotempty(SessionId)), StartedAt = min(StartedAt), EndedAt = max(EndedAt) by RunId;
let FailedRuns = union
    (Rs | where OutcomeStatus in~ ("failed", "blocked", "error") | project RunId),
    (Ev | where Status in~ ("failed", "error", "denied", "blocked") | project RunId),
    (Sp | where Outcome in~ ("failed", "error") | project RunId)
| distinct RunId;`;

// Token precedence per run (never summed across sources, spans deduped):
// run summary > chat spans > invoke_agent spans > session.shutdown events.
const tokens = `let EvModel = Ev
| where isnotempty(ModelActual) or isnotempty(ModelRequested)
| summarize arg_max(TimeGenerated, ModelActual, ModelRequested) by RunId
| project RunId, RunModel = coalesce(ModelActual, ModelRequested);
let TokSummary = Rs
| where isnotnull(InputTokens) or isnotnull(OutputTokens)
| project RunId, Model = coalesce(ModelActual, ModelRequested), InputTokens = tolong(InputTokens), OutputTokens = tolong(OutputTokens), TokenSource = "run summary";
let TokChat = Sp
| where OperationName == "chat"
| join kind=leftanti (TokSummary | project RunId) on RunId
| project RunId, Model = coalesce(ModelActual, Model, ModelRequested), InputTokens = tolong(InputTokens), OutputTokens = tolong(OutputTokens), TokenSource = "chat spans";
let TokInvoke = Sp
| where OperationName == "invoke_agent"
| join kind=leftanti (union (TokSummary | project RunId), (TokChat | project RunId)) on RunId
| join kind=leftouter EvModel on RunId
| project RunId, Model = coalesce(ModelActual, Model, ModelRequested, RunModel), InputTokens = tolong(InputTokens), OutputTokens = tolong(OutputTokens), TokenSource = "invoke_agent spans";
let TokShutdown = Ev
| where EventName == "session.shutdown"
| join kind=leftanti (union (TokSummary | project RunId), (TokChat | project RunId), (TokInvoke | project RunId)) on RunId
| project RunId, Model = coalesce(ModelActual, ModelRequested), InputTokens = tolong(InputTokens), OutputTokens = tolong(OutputTokens), TokenSource = "session.shutdown events";
let Tokens = union TokSummary, TokChat, TokInvoke, TokShutdown
| extend Model = iff(isempty(Model), "unknown", Model), InputTokens = coalesce(InputTokens, 0), OutputTokens = coalesce(OutputTokens, 0)
| extend EstCostUsd = (InputTokens * todouble("\${${PRICE_IN_VAR}}") + OutputTokens * todouble("\${${PRICE_OUT_VAR}}")) / 1000000.0;`;

const q = (...parts) => parts.join('\n');

const queries = {
  runs: q(base, runs, `Runs
| summarize Runs = dcount(RunId)`),
  failureRate: q(base, runs, `Runs
| summarize Runs = dcount(RunId), RunsWithFailure = dcountif(RunId, RunId in (FailedRuns))
| project FailureRatePct = iff(Runs == 0, real(null), round(100.0 * RunsWithFailure / Runs, 1))`),
  failedToolCalls: q(base, tools, `Tools
| summarize FailedToolCalls = countif(Failed)`),
  tokensIn: q(base, tokens, `Tokens
| summarize InputTokens = sum(InputTokens)`),
  tokensOut: q(base, tokens, `Tokens
| summarize OutputTokens = sum(OutputTokens)`),
  estCost: q(base, tokens, `Tokens
| summarize EstCostUsd = round(sum(EstCostUsd), 4)`),
  runsOverTime: q(base, runs, `Runs
| extend Outcome = iff(RunId in (FailedRuns), "with failure signal", "without failure signal")
| summarize Runs = dcount(RunId) by TimeGenerated = bin(StartedAt, $__interval), Outcome
| order by TimeGenerated asc`),
  topFailingTools: q(base, tools, `Tools
| summarize Calls = count(), Failed = countif(Failed), Runs = dcount(RunId) by ToolName
| where Failed > 0
| extend FailureRatePct = round(100.0 * Failed / Calls, 1)
| top 10 by Failed desc
| project ToolName, Failed, Calls, FailureRatePct, Runs`),
  toolLatency: q(base, tools, `Tools
| where isnotnull(LatencyMs) and LatencyMs >= 0
| summarize Calls = count(), P50Ms = round(percentile(LatencyMs, 50), 0), P95Ms = round(percentile(LatencyMs, 95), 0), MaxMs = round(max(LatencyMs), 0), Failed = countif(Failed) by ToolName
| top 15 by P95Ms desc
| project ToolName, P50Ms, P95Ms, MaxMs, Calls, Failed`),
  tokensByModel: q(base, tokens, `Tokens
| summarize InputTokens = sum(InputTokens), OutputTokens = sum(OutputTokens) by Model
| order by InputTokens desc`),
  costByModel: q(base, tokens, `Tokens
| summarize Runs = dcount(RunId), InputTokens = sum(InputTokens), OutputTokens = sum(OutputTokens), EstCostUsd = round(sum(EstCostUsd), 4), TokenSources = strcat_array(make_set(TokenSource), ", ") by Model
| order by EstCostUsd desc`),
  slowestRuns: q(base, tools, runs, tokens, `let RunTools = Tools
| summarize ToolCalls = count(), FailedTools = countif(Failed) by RunId;
let RunTokens = Tokens
| summarize Models = strcat_array(make_set(Model), ", "), InputTokens = sum(InputTokens), OutputTokens = sum(OutputTokens), EstCostUsd = round(sum(EstCostUsd), 4) by RunId;
Runs
| join kind=leftouter (Rs | project RunId, SummaryDurationMs = DurationMs, OutcomeStatus) on RunId
| join kind=leftouter RunTools on RunId
| join kind=leftouter RunTokens on RunId
| extend DurationSec = round(todouble(coalesce(SummaryDurationMs, datetime_diff("millisecond", EndedAt, StartedAt))) / 1000.0, 1)
| extend Outcome = case(isnotempty(OutcomeStatus), OutcomeStatus, RunId in (FailedRuns), "failure signal", "no failure signal")
| top 20 by DurationSec desc
| project StartedAt, RunId, SessionId, DurationSec, Outcome, Models, ToolCalls = coalesce(ToolCalls, 0), FailedTools = coalesce(FailedTools, 0), InputTokens, OutputTokens, EstCostUsd`)
};

function target(query, resultFormat = 'table') {
  return [{
    refId: 'A',
    datasource,
    queryType: 'Azure Log Analytics',
    azureLogAnalytics: {
      query,
      resources: ['$workspace'],
      resultFormat,
      dashboardTime: false
    }
  }];
}

let nextId = 1;
function panel(type, title, description, gridPos, query, extra = {}) {
  return {
    id: nextId++,
    type,
    title,
    description,
    datasource,
    gridPos,
    targets: target(query, extra.resultFormat || 'table'),
    fieldConfig: extra.fieldConfig || { defaults: {}, overrides: [] },
    options: extra.options || {}
  };
}

function stat(title, description, x, query, unit, extra = {}) {
  return panel('stat', title, description, { h: 4, w: 4, x, y: 3 }, query, {
    fieldConfig: { defaults: { unit, decimals: extra.decimals, noValue: extra.noValue || '0', color: { mode: 'thresholds' }, thresholds: extra.thresholds || { mode: 'absolute', steps: [{ color: 'blue', value: null }] } }, overrides: [] },
    options: { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'value', graphMode: 'none', textMode: 'value', justifyMode: 'center', orientation: 'auto' }
  });
}

const intro = {
  id: nextId++,
  type: 'text',
  title: '',
  gridPos: { h: 3, w: 24, x: 0, y: 0 },
  options: {
    mode: 'markdown',
    content: [
      '**Copilot CLI AgentOps** — runs, failures, tool latency, tokens and estimated cost from the AgentOps Log Analytics tables (`AgentOpsEvents_CL`, `AgentOpsSpans_CL`, `AgentOpsRunSummary_CL`).',
      'Metadata only: no prompts, tool arguments, tool results or code are queried. Spans and events are deduplicated before counting. ',
      '**Est. cost** is tokens × the blended list price in the dashboard variables (input/output USD per 1M tokens). It is an estimate, not billed cost: Copilot CLI does not report cost.'
    ].join('\n')
  }
};

const failureThresholds = { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'orange', value: 10 }, { color: 'red', value: 25 }] };

const panels = [
  intro,
  stat('Runs', 'Distinct RunId values seen in any AgentOps table in the time range.', 0, queries.runs, 'short'),
  stat('Failure rate', 'Share of runs with at least one failure signal: a failed/blocked run summary, a failed/denied event or a failed span. A nonzero shell exit is recorded by Copilot CLI as a successful tool call, so it is not counted.', 4, queries.failureRate, 'percent', { decimals: 1, noValue: 'n/a', thresholds: failureThresholds }),
  stat('Failed tool calls', 'Tool calls whose completion status was failed, error, denied or blocked (deduplicated by tool call).', 8, queries.failedToolCalls, 'short', { thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'orange', value: 1 }] } }),
  stat('Tokens in', 'Input tokens. One source per run, in this order: run summary, chat spans, invoke_agent spans, session.shutdown events. Duplicate spans are removed first.', 12, queries.tokensIn, 'short'),
  stat('Tokens out', 'Output tokens, using the same per-run source order as Tokens in.', 16, queries.tokensOut, 'short'),
  stat('Est. cost (USD, not billed)', 'Estimate = input tokens × input price + output tokens × output price, using the dashboard variables (USD per 1M tokens). Not a bill: Copilot CLI emits no cost metadata.', 20, queries.estCost, 'currencyUSD', { decimals: 2 }),
  panel('timeseries', 'Runs over time', 'Distinct runs per interval, split by whether the run had any failure signal.', { h: 8, w: 12, x: 0, y: 7 }, queries.runsOverTime, {
    resultFormat: 'time_series',
    fieldConfig: { defaults: { unit: 'short', custom: { drawStyle: 'bars', fillOpacity: 80, stacking: { mode: 'normal', group: 'A' }, lineWidth: 1 } }, overrides: [
      { matcher: { id: 'byRegexp', options: '.*with failure signal.*' }, properties: [{ id: 'color', value: { mode: 'fixed', fixedColor: 'red' } }, { id: 'displayName', value: 'Runs with a failure signal' }] },
      { matcher: { id: 'byRegexp', options: '.*without failure signal.*' }, properties: [{ id: 'color', value: { mode: 'fixed', fixedColor: 'green' } }, { id: 'displayName', value: 'Runs without failure signals' }] }
    ] },
    options: { legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'multi', sort: 'none' } }
  }),
  panel('table', 'Top failing tools', 'Tools with the most failed calls (failed, error, denied or blocked). Tool calls are deduplicated by tool call ID.', { h: 8, w: 12, x: 12, y: 7 }, queries.topFailingTools, {
    fieldConfig: { defaults: { custom: { align: 'auto' } }, overrides: [
      { matcher: { id: 'byName', options: 'Failed' }, properties: [{ id: 'custom.cellOptions', value: { type: 'color-background', mode: 'basic' } }, { id: 'color', value: { mode: 'fixed', fixedColor: 'red' } }] },
      { matcher: { id: 'byName', options: 'FailureRatePct' }, properties: [{ id: 'unit', value: 'percent' }, { id: 'displayName', value: 'Failure rate' }] }
    ] },
    options: { showHeader: true, sortBy: [{ displayName: 'Failed', desc: true }] }
  }),
  panel('table', 'Tool latency p50 / p95 by tool', 'Latency from tool start to completion events, or span duration when events are absent. Sorted by p95.', { h: 9, w: 12, x: 0, y: 15 }, queries.toolLatency, {
    fieldConfig: { defaults: { custom: { align: 'auto' } }, overrides: [
      { matcher: { id: 'byRegexp', options: '^(P50Ms|P95Ms|MaxMs)$' }, properties: [{ id: 'unit', value: 'ms' }] },
      { matcher: { id: 'byName', options: 'P95Ms' }, properties: [{ id: 'custom.cellOptions', value: { type: 'gauge', mode: 'basic' } }, { id: 'displayName', value: 'p95' }] },
      { matcher: { id: 'byName', options: 'P50Ms' }, properties: [{ id: 'displayName', value: 'p50' }] },
      { matcher: { id: 'byName', options: 'MaxMs' }, properties: [{ id: 'displayName', value: 'max' }] }
    ] },
    options: { showHeader: true, sortBy: [{ displayName: 'p95', desc: true }] }
  }),
  panel('barchart', 'Tokens in / out by model', 'Input and output tokens per model. One token source per run; duplicate spans removed. Never summed across duplicate spans or across sources.', { h: 9, w: 12, x: 12, y: 15 }, queries.tokensByModel, {
    fieldConfig: { defaults: { unit: 'short', custom: { fillOpacity: 80, lineWidth: 1 } }, overrides: [] },
    options: { orientation: 'horizontal', xField: 'Model', stacking: 'none', showValue: 'auto', groupWidth: 0.7, barWidth: 0.9, legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'multi', sort: 'none' } }
  }),
  panel('table', 'Est. cost by model (USD, not billed)', 'Estimated cost per model from the blended price variables. TokenSources shows which telemetry the token counts came from.', { h: 8, w: 24, x: 0, y: 24 }, queries.costByModel, {
    fieldConfig: { defaults: { custom: { align: 'auto' } }, overrides: [
      { matcher: { id: 'byName', options: 'EstCostUsd' }, properties: [{ id: 'unit', value: 'currencyUSD' }, { id: 'decimals', value: 4 }, { id: 'displayName', value: 'Est. cost (USD)' }] }
    ] },
    options: { showHeader: true, sortBy: [{ displayName: 'Est. cost (USD)', desc: true }] }
  }),
  panel('table', 'Slowest runs', 'Top 20 runs by duration. Duration comes from the run summary when present, otherwise from the first to last event or span end. Est. cost uses the price variables.', { h: 10, w: 24, x: 0, y: 32 }, queries.slowestRuns, {
    fieldConfig: { defaults: { custom: { align: 'auto' } }, overrides: [
      { matcher: { id: 'byName', options: 'DurationSec' }, properties: [{ id: 'unit', value: 's' }, { id: 'custom.cellOptions', value: { type: 'gauge', mode: 'basic' } }, { id: 'displayName', value: 'Duration' }] },
      { matcher: { id: 'byName', options: 'EstCostUsd' }, properties: [{ id: 'unit', value: 'currencyUSD' }, { id: 'decimals', value: 4 }, { id: 'displayName', value: 'Est. cost (USD)' }] },
      { matcher: { id: 'byName', options: 'FailedTools' }, properties: [{ id: 'custom.cellOptions', value: { type: 'color-text' } }, { id: 'thresholds', value: { mode: 'absolute', steps: [{ color: 'text', value: null }, { color: 'red', value: 1 }] } }] }
    ] },
    options: { showHeader: true, sortBy: [{ displayName: 'Duration', desc: true }] }
  })
];

const dashboard = {
  title: 'Copilot CLI AgentOps',
  uid: 'agentops-copilot-cli',
  description: 'Portable AgentOps dashboard for Copilot CLI runs. Uses only the built-in Azure Monitor datasource and the AgentOps Log Analytics tables. Works in Azure Monitor dashboards with Grafana, Azure Managed Grafana and self-hosted Grafana.',
  tags: ['agentops', 'copilot-cli', 'azure-monitor', 'portable'],
  editable: true,
  graphTooltip: 1,
  schemaVersion: 39,
  version: 1,
  refresh: '',
  time: { from: 'now-7d', to: 'now' },
  timepicker: {},
  timezone: 'browser',
  links: [],
  annotations: { list: [] },
  templating: {
    list: [
      {
        name: 'datasource',
        label: 'Azure Monitor data source',
        type: 'datasource',
        query: DATASOURCE_TYPE,
        regex: '',
        hide: 0,
        refresh: 1,
        includeAll: false,
        multi: false,
        current: {},
        options: []
      },
      {
        name: 'subscription',
        label: 'Subscription',
        type: 'query',
        datasource,
        query: { queryType: 'Azure Subscriptions', refId: 'A' },
        definition: 'Azure Subscriptions',
        refresh: 1,
        hide: 0,
        includeAll: false,
        multi: false,
        sort: 1,
        current: {},
        options: []
      },
      {
        name: 'workspace',
        label: 'Log Analytics workspace',
        type: 'query',
        datasource,
        query: { queryType: 'Azure Workspaces', subscription: '$subscription', refId: 'A' },
        definition: 'Azure Workspaces ($subscription)',
        refresh: 1,
        hide: 0,
        includeAll: false,
        multi: false,
        sort: 1,
        current: {},
        options: []
      },
      {
        name: PRICE_IN_VAR,
        label: 'Est. input price (USD / 1M tokens)',
        description: 'Blended list price used only for the estimated cost panels. Edit it to match your model mix.',
        type: 'textbox',
        query: DEFAULT_PRICE_IN,
        hide: 0,
        current: { text: DEFAULT_PRICE_IN, value: DEFAULT_PRICE_IN },
        options: [{ selected: true, text: DEFAULT_PRICE_IN, value: DEFAULT_PRICE_IN }]
      },
      {
        name: PRICE_OUT_VAR,
        label: 'Est. output price (USD / 1M tokens)',
        description: 'Blended list price used only for the estimated cost panels. Edit it to match your model mix.',
        type: 'textbox',
        query: DEFAULT_PRICE_OUT,
        hide: 0,
        current: { text: DEFAULT_PRICE_OUT, value: DEFAULT_PRICE_OUT },
        options: [{ selected: true, text: DEFAULT_PRICE_OUT, value: DEFAULT_PRICE_OUT }]
      }
    ]
  },
  panels
};

function render() {
  return `${JSON.stringify(dashboard, null, 2)}\n`;
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== render()) {
      console.error(`${path.relative(repoRoot, outFile)} is out of date. Run: node scripts/build-grafana-portable-dashboard.js`);
      process.exit(1);
    }
    console.log(`${path.relative(repoRoot, outFile)} is up to date`);
  } else {
    fs.writeFileSync(outFile, render());
    console.log(`wrote ${path.relative(repoRoot, outFile)}`);
  }
}

module.exports = { dashboard, render, PRICE_IN_VAR, PRICE_OUT_VAR };
