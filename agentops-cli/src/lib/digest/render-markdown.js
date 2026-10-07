const {
  compactNumber,
  costLabel,
  day,
  duration,
  glanceRows,
  listPreview,
  stamp,
  usd
} = require('./format');

const MAX_CLUSTERS = 10;

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function renderDigestMarkdown(digest) {
  const lines = [];
  const { period, current, failureClusters: clusters } = digest;
  lines.push(`# AgentOps digest: last ${period.label}`);
  lines.push('');
  lines.push(`${day(period.start)} to ${day(period.end)}, compared with ${day(period.previousStart)} to ${day(period.previousEnd)}.`);
  lines.push('Metadata only: no prompts, tool arguments, results or error messages.');
  lines.push('');
  lines.push('## At a glance');
  lines.push('');
  lines.push('| Metric | This period | Previous | Change |');
  lines.push('| --- | --- | --- | --- |');
  for (const row of glanceRows(digest)) {
    lines.push(`| ${cell(row.metric)} | ${cell(row.now)} | ${cell(row.before)} | ${cell(row.change.text)} |`);
  }
  const hints = glanceRows(digest).filter(row => row.hint).map(row => `${row.metric}: ${row.hint}.`);
  if (hints.length) {
    lines.push('');
    for (const hint of hints) lines.push(`- ${hint}`);
  }
  lines.push('');
  lines.push('## Top actions');
  lines.push('');
  digest.recommendations.forEach((action, index) => lines.push(`${index + 1}. ${action.text}`));
  lines.push('');
  lines.push(`## Tool issue clusters: ${clusters.headline}`);
  lines.push('');
  if (!clusters.clusters.length) {
    lines.push('No failed, denied or non-zero-exit tool calls in this period.');
  }
  clusters.clusters.slice(0, MAX_CLUSTERS).forEach((cluster, index) => {
    lines.push(`${index + 1}. **${cluster.tool}** · ${cluster.errorType} · ${cluster.model}: ${cluster.count} ${cluster.severity === 'attention' ? 'needing attention' : 'failed'} in ${cluster.runCount} run${cluster.runCount === 1 ? '' : 's'}`);
    lines.push(`   Seen ${stamp(cluster.firstSeen)} to ${stamp(cluster.lastSeen)} UTC. Repos: ${listPreview(cluster.repos)}.`);
    lines.push(`   Example run: \`${cluster.representativeRunId}\``);
    lines.push(`   Next: ${cluster.suggestedNextStep}`);
  });
  if (clusters.clusters.length > MAX_CLUSTERS) {
    lines.push('');
    lines.push(`${clusters.clusters.length - MAX_CLUSTERS} smaller cluster(s) omitted; use --format json for all of them.`);
  }
  lines.push('');
  lines.push('## Slowest tools (p95)');
  lines.push('');
  if (!digest.slowestTools.length) {
    lines.push('No completed tool calls in this period.');
  } else {
    lines.push('| Tool | Calls | p50 | p95 | Max |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const tool of digest.slowestTools) {
      lines.push(`| ${cell(tool.tool)} | ${tool.calls} | ${duration(tool.p50Ms)} | ${duration(tool.p95Ms)} | ${duration(tool.maxMs)} |`);
    }
  }
  lines.push('');
  lines.push('## Tokens by model');
  lines.push('');
  if (!current.tokens.models.length) {
    lines.push('No token usage reported in this period.');
  } else {
    lines.push('| Model | Sessions | Input | Output | Cache read | Cost |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const model of current.tokens.models) {
      lines.push(`| ${cell(model.model)} | ${model.sessions} | ${compactNumber(model.inputTokens)} | ${compactNumber(model.outputTokens)} | ${compactNumber(model.cacheReadTokens)} | ${usd(model.estCostUsd)} |`);
    }
    lines.push('');
    lines.push(`Total: ${compactNumber(current.tokens.totalTokens)} tokens, ${costLabel(current.tokens)}.`);
  }
  lines.push('');
  lines.push('---');
  const sources = digest.sources || {};
  lines.push(`Sources: ${sources.sessionsScanned ?? 0} local Copilot CLI session file(s) scanned, ${sources.linkedRuns ?? 0} linked to AgentOps runs. Generated ${stamp(digest.generatedAt)} UTC.`);
  lines.push(`Cost: ${digest.priceTable || 'no price table'}. Cache reads and writes are priced separately. Example runs show the AgentOps run ID when one exists, otherwise the Copilot session ID.`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderDigestMarkdown
};
