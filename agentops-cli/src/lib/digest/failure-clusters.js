const { hashText } = require('../hash');
const { classifyToolCompletionEvent, severityOfOutcome } = require('../copilot/run-status');

// Metadata-only failure clustering. Inputs are already-classified failure
// records; no prompt text, tool arguments, results or error messages are kept.
const SAFE_LABEL = /^[A-Za-z0-9_.:@/\-]{1,80}$/;
const SAFE_RULE_TARGET = /^[A-Za-z0-9_.\- ]{1,40}$/;
const SAFE_TOOL_LABEL = /^[A-Za-z0-9_.:@/\-]{1,80}(\([A-Za-z0-9_.\- ]{1,40}\))?$/;
const SAFE_CODE = /^[a-z][a-z0-9_]{1,30}$/;

const SHELL_TOOLS = new Set(['bash', 'powershell', 'shell']);

const ERROR_TYPES = Object.freeze([
  'denied', 'blocked', 'timeout', 'rate_limited', 'nonzero_exit',
  'unknown_tool', 'invalid_input', 'not_found', 'error'
]);

function safeLabel(value, fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return SAFE_LABEL.test(text) ? text : fallback;
}

// Tool labels may carry an extracted permission rule such as `shell(curl)`.
function safeToolLabel(value, fallback = 'unknown-tool') {
  const text = String(value ?? '').trim();
  return SAFE_TOOL_LABEL.test(text) ? text : fallback;
}

// A denied message names the permission rule that matched, e.g. `shell(curl:*)`.
// The rule is the user's own allow/deny configuration, not command arguments,
// so only a strictly allowlisted `<kind>(<target>)` is extracted from it.
function deniedRuleTool(message) {
  const rules = [];
  const pattern = /`([a-z][a-z0-9_-]{0,30})\(([^`()]{1,60})\)`/g;
  let match;
  while ((match = pattern.exec(String(message || ''))) !== null) {
    const target = match[2].replace(/:\*$/, '').trim();
    if (SAFE_RULE_TARGET.test(target)) rules.push(`${match[1]}(${target})`);
  }
  return rules.sort()[0] || '';
}

function exitCodeOf(completion = {}) {
  const code = completion.shellExecution?.exitCode;
  return Number.isSafeInteger(code) ? code : null;
}

// Tool-call outcome from the shared run-status rules: 'ok', 'failed',
// 'denied' or 'nonzero_exit'. Only 'failed' is a failure; the others need attention.
function completionOutcome(completion = {}) {
  return classifyToolCompletionEvent(completion);
}

// True for any completion worth clustering: failures and attention signals.
function isFailedCompletion(completion = {}) {
  return completionOutcome(completion) !== 'ok';
}

// Error types that only make sense for an attention outcome are renamed when
// the shared rules say the call actually failed, so labels never contradict counts.
const ATTENTION_ONLY_TYPES = Object.freeze({ denied: 'error:permission_denied', nonzero_exit: 'error:nonzero_exit' });

function severityOf(record = {}) {
  if (record.severity === 'failure' || record.severity === 'attention') return record.severity;
  return ATTENTION_ONLY_TYPES[record.errorType] ? 'attention' : 'failure';
}

function errorTypeOf(completion = {}) {
  const code = String(completion.error?.code || '').toLowerCase();
  const message = String(completion.error?.message || '');
  const category = String(completion.toolTelemetry?.properties?.shell_error_category || '').toLowerCase();
  const exitCode = exitCodeOf(completion);
  if (code === 'denied' || category === 'permission_denied' || /permission denied|was denied/i.test(message)) return 'denied';
  if (category.includes('blocked') || /\bblocked\b|not executed/i.test(message)) return 'blocked';
  if (code === 'timeout' || /timed? ?out|timeout/i.test(message)) return 'timeout';
  if (/rate limit/i.test(message)) return 'rate_limited';
  if (category === 'command_nonzero_exit' || (exitCode !== null && exitCode !== 0)) return 'nonzero_exit';
  if (/^tool '[^']*' does not exist/i.test(message)) return 'unknown_tool';
  if (category === 'invalid_input' || /invalid|requires|out of bounds|must /i.test(message)) return 'invalid_input';
  if (/does not exist|not found|no such file|no match/i.test(message)) return 'not_found';
  return SAFE_CODE.test(code) && !['failure', 'error'].includes(code) ? `error:${code}` : 'error';
}

function classifyToolFailure(start = {}, completion = {}) {
  const outcome = completionOutcome(completion);
  if (outcome === 'ok') return null;
  let errorType = outcome === 'failed' ? errorTypeOf(completion) : outcome;
  if (outcome === 'failed' && ATTENTION_ONLY_TYPES[errorType]) errorType = ATTENTION_ONLY_TYPES[errorType];
  const ruleTool = errorType === 'denied' ? deniedRuleTool(completion.error?.message) : '';
  return {
    tool: ruleTool || safeLabel(start.toolName || completion.toolName, 'unknown-tool'),
    errorType,
    severity: severityOfOutcome(outcome),
    model: safeLabel(completion.model || start.model, 'unknown-model')
  };
}

function fingerprintOf(failure) {
  const errorType = ERROR_TYPES.includes(failure.errorType) || /^error:[a-z][a-z0-9_]{1,30}$/.test(String(failure.errorType)) ? failure.errorType : 'error';
  return `${safeToolLabel(failure.tool)}|${errorType}|${safeLabel(failure.model, 'unknown-model')}`;
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function suggestNextStep(cluster) {
  const { tool, errorType, representativeRunId, representativeSessionId } = cluster;
  const runFlag = representativeRunId && representativeRunId !== representativeSessionId ? ` --run-id ${representativeRunId}` : '';
  const view = representativeSessionId ? ` Inspect it with \`agentops copilot-session view ${representativeSessionId}${runFlag} --output digest-run.html\`.` : '';
  switch (true) {
    case errorType === 'denied':
      return `Add --allow-tool ${quoteShell(SHELL_TOOLS.has(tool) ? 'shell' : tool)} if the agent needs it, or keep it denied deliberately and tell the agent not to try it.`;
    case errorType === 'blocked':
      return `Copilot's safety rules blocked ${tool}; update the agent instructions so it stops attempting this command.`;
    case errorType === 'timeout':
      return `${tool} timed out; split the work into smaller steps or raise the tool timeout.${view}`;
    case errorType === 'rate_limited':
      return `${tool} hit a rate limit; reduce call volume, authenticate the MCP server, or add backoff.`;
    case errorType === 'nonzero_exit':
      return `Commands run via ${tool} exited non-zero; check the representative run and add the missing setup or test command to the repo instructions.${view}`;
    case errorType === 'unknown_tool':
      return `The model called a tool that does not exist; pin a model that knows the current tool set or name the right tool in instructions.`;
    case errorType === 'invalid_input':
      return `The model sent invalid input to ${tool}; add a usage example for this tool to the repo instructions.${view}`;
    case errorType === 'not_found':
      return `${tool} was pointed at missing paths or items; describe the repo layout in the instructions so the agent stops guessing.${view}`;
    default:
      return `Open the representative run to see why ${tool} failed.${view}`;
  }
}

function compareFailures(left, right) {
  return String(left.at || '').localeCompare(String(right.at || ''))
    || String(left.runId || left.sessionId || '').localeCompare(String(right.runId || right.sessionId || ''));
}

function clusterFailures(failures = []) {
  const groups = new Map();
  for (const failure of failures) {
    const fingerprint = fingerprintOf(failure);
    const list = groups.get(fingerprint) || [];
    list.push(failure);
    groups.set(fingerprint, list);
  }
  const clusters = [...groups.entries()].map(([fingerprint, list]) => {
    const ordered = [...list].sort(compareFailures);
    const [tool, errorType, model] = fingerprint.split('|');
    const latest = ordered[ordered.length - 1];
    const severity = severityOf(latest);
    const runs = [...new Set(ordered.map(item => item.runId || item.sessionId).filter(Boolean))].sort();
    const repos = [...new Set(ordered.map(item => item.repo).filter(Boolean))].sort();
    const cluster = {
      id: `fc_${hashText(fingerprint).slice(0, 10)}`,
      fingerprint,
      tool,
      errorType,
      severity,
      model,
      count: ordered.length,
      firstSeen: ordered[0].at || '',
      lastSeen: latest.at || '',
      runCount: runs.length,
      runs,
      repos,
      representativeRunId: latest.runId || latest.sessionId || '',
      representativeSessionId: latest.sessionId || ''
    };
    cluster.suggestedNextStep = suggestNextStep(cluster);
    return cluster;
  }).sort((left, right) => right.count - left.count || left.fingerprint.localeCompare(right.fingerprint));
  const total = failures.length;
  const failed = failures.filter(item => severityOf(item) === 'failure').length;
  const attention = total - failed;
  return {
    total,
    failed,
    attention,
    clusterCount: clusters.length,
    headline: `${total} tool issue${total === 1 ? '' : 's'} in ${clusters.length} cluster${clusters.length === 1 ? '' : 's'}: ${failed} failed, ${attention} need${attention === 1 ? 's' : ''} attention`,
    clusters
  };
}

module.exports = {
  ERROR_TYPES,
  classifyToolFailure,
  clusterFailures,
  completionOutcome,
  deniedRuleTool,
  errorTypeOf,
  fingerprintOf,
  isFailedCompletion,
  safeLabel,
  safeToolLabel,
  severityOf,
  suggestNextStep
};
