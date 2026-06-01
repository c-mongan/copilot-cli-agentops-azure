const path = require('node:path');

const { hasFlag, optionValue } = require('../lib/args');
const { buildAzureIngestPlan, renderAzureIngestPlan } = require('../lib/azure/v2-ingest-plan');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function azureIngestCommand(args = []) {
  const [subcommand = 'plan'] = args;
  if (subcommand !== 'plan') throw new Error('azure-ingest supports: plan');

  const dir = optionValue(args, '--dir', path.join(repoRoot, '.agentops', 'demo', 'latest'));
  const plan = buildAzureIngestPlan({ dir, allowContent: hasFlag(args, '--allow-content') });

  if (hasFlag(args, '--json')) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    process.stdout.write(renderAzureIngestPlan(plan));
  }
  if (!plan.ok) process.exitCode = 1;
}

module.exports = {
  azureIngestCommand
};
