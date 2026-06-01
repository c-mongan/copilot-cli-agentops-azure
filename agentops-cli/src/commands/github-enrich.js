const path = require('node:path');

const { hasFlag, optionValue } = require('../lib/args');
const { enrichGithubOutcomes, writeGithubOutcomes } = require('../lib/github/outcome-enricher');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function githubEnrichCommand(args = []) {
  const outDir = path.resolve(optionValue(args, '--out', path.join(repoRoot, '.agentops', 'github-outcomes', 'latest')));
  const limit = Number(optionValue(args, '--limit', '30'));
  const runsFile = optionValue(args, '--runs') ? path.resolve(optionValue(args, '--runs')) : null;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) throw new Error('--limit must be an integer between 1 and 200');

  const result = enrichGithubOutcomes({ limit, runsFile });
  if (result.ok) {
    const written = writeGithubOutcomes(result.rows, outDir);
    result.out_dir = written.out_dir;
    result.manifest = written.manifest;
    result.file = written.file;
    result.next = [
      `agentops latest --file ${written.file}`,
      'agentops dashboard validate'
    ];
  }

  if (hasFlag(args, '--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`Generated ${result.rows.length} GitHub outcome row${result.rows.length === 1 ? '' : 's'}.\n`);
    process.stdout.write(`Output: ${result.file}\n`);
  } else {
    process.stdout.write(`Could not enrich GitHub outcomes: ${result.error}\n`);
  }
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  githubEnrichCommand
};
