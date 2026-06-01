const path = require('node:path');

const { hasFlag, optionValue } = require('../lib/args');
const { generateInsights, readJsonl, writeInsights } = require('../lib/insights/deterministic-insights');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function patternRows(rows = []) {
  return rows
    .filter(row => row.PatternId || row.PatternKey || String(row.InsightType || '').startsWith('recurring-'))
    .sort((a, b) => Number(b.PatternRuns || 0) - Number(a.PatternRuns || 0) || String(b.TimeGenerated || '').localeCompare(String(a.TimeGenerated || '')));
}

function renderPatterns(rows = []) {
  const patterns = patternRows(rows);
  const lines = ['AgentOps recurring patterns', ''];
  if (patterns.length === 0) {
    lines.push('No recurring metadata-only patterns found.');
    lines.push('Next: run `agentops insights generate --runs <AgentOpsRunSummary_CL.jsonl>` after collecting more runs.');
    return `${lines.join('\n')}\n`;
  }
  for (const row of patterns.slice(0, 10)) {
    lines.push(`- ${row.Severity || 'info'} ${row.InsightType}: ${row.PatternRuns || 0} run(s), ${row.PatternDimension || 'pattern'}`);
    lines.push(`  ${row.Summary || ''}`);
    lines.push(`  Next: ${row.SuggestedNextStep || 'Open Insights & Regressions.'}`);
    lines.push(`  PatternKey: ${row.PatternKey || ''}`);
  }
  return `${lines.join('\n')}\n`;
}

function insightsCommand(args = []) {
  const [subcommand = 'generate'] = args;
  if (!['generate', 'patterns'].includes(subcommand)) throw new Error('insights supports: generate|patterns');

  if (subcommand === 'patterns') {
    const insightsFile = optionValue(args, '--insights', path.join(repoRoot, '.agentops', 'insights', 'latest', 'AgentOpsInsights_CL.jsonl'));
    const patterns = patternRows(readJsonl(path.resolve(insightsFile)));
    const payload = {
      ok: true,
      insights_file: path.resolve(insightsFile),
      patterns,
      pattern_count: patterns.length,
      next: [
        'agentops open latest --runs .agentops/demo/latest/AgentOpsRunSummary_CL.jsonl',
        'Open the Insights & Regressions dashboard and click OpenPattern.'
      ]
    };
    process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(payload, null, 2)}\n` : renderPatterns(patterns));
    return;
  }

  const runsFile = optionValue(args, '--runs');
  if (!runsFile) throw new Error('insights generate requires --runs <AgentOpsRunSummary_CL.jsonl>');

  const outDir = path.resolve(optionValue(args, '--out', path.join(repoRoot, '.agentops', 'insights', 'latest')));
  const result = generateInsights({
    runs: readJsonl(path.resolve(runsFile)),
    tools: readJsonl(optionValue(args, '--tools')),
    privacy: readJsonl(optionValue(args, '--privacy')),
    github: readJsonl(optionValue(args, '--github')),
    evals: readJsonl(optionValue(args, '--baseline-evals')),
    baselineTools: readJsonl(optionValue(args, '--baseline-tools'))
  });
  const written = writeInsights(result, outDir);
  const payload = {
    ok: result.ok,
    out_dir: outDir,
    eval_file: written.evalFile,
    insights_file: written.insightsFile,
    table_counts: result.table_counts,
    next: [
      `agentops replay latest --file ${optionValue(args, '--events', '.agentops/demo/latest/AgentOpsEvents_CL.jsonl')}`,
      'agentops dashboard validate'
    ]
  };

  if (hasFlag(args, '--json')) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`Generated ${payload.table_counts.AgentOpsEval_CL} eval row${payload.table_counts.AgentOpsEval_CL === 1 ? '' : 's'} and ${payload.table_counts.AgentOpsInsights_CL} insight row${payload.table_counts.AgentOpsInsights_CL === 1 ? '' : 's'}.\n`);
    process.stdout.write(`Output: ${payload.out_dir}\n`);
  }
}

module.exports = {
  insightsCommand,
  patternRows,
  renderPatterns
};
