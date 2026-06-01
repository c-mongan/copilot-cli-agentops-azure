const path = require('node:path');

const { hasFlag, optionValue } = require('../lib/args');
const { readJsonlRows, rollupSpanRows, writeTables } = require('../lib/rollup/span-to-agentops-tables');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function runSummaryCommand(args = []) {
  const [subcommand = 'generate'] = args;
  if (subcommand !== 'generate') throw new Error('run-summary supports: generate');

  const file = optionValue(args, ['--file', '--jsonl']);
  if (!file) throw new Error('run-summary generate requires --file <jsonl>');

  const input = path.resolve(file);
  const outDir = path.resolve(optionValue(args, '--out', path.join(repoRoot, '.agentops', 'run-summary', 'latest')));
  const rows = readJsonlRows(input);
  const result = rollupSpanRows(rows, {
    surface: optionValue(args, '--surface', 'cli'),
    repo: optionValue(args, '--repo', 'unknown-repo'),
    branch: optionValue(args, '--branch', 'unknown-branch')
  });
  const written = writeTables(result, outDir);
  const payload = {
    ok: result.ok,
    input,
    runs: result.runs,
    out_dir: written.out_dir,
    manifest: written.manifest,
    table_counts: result.table_counts,
    next: [
      `agentops latest --file ${written.files.AgentOpsRunSummary_CL}`,
      `agentops replay latest --file ${written.files.AgentOpsEvents_CL}`
    ]
  };

  if (hasFlag(args, '--json')) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`Generated ${payload.runs} AgentOps run summar${payload.runs === 1 ? 'y' : 'ies'}.\n`);
    process.stdout.write(`Output: ${payload.out_dir}\n`);
    process.stdout.write(`Next: ${payload.next[0]}\n`);
  }
}

module.exports = {
  runSummaryCommand
};
