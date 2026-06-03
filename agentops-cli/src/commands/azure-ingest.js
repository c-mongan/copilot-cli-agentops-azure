const path = require('node:path');

const { hasFlag, optionValue } = require('../lib/args');
const {
  buildAzureIngestPlan,
  buildSharedStorageUploadPlan,
  renderAzureIngestPlan,
  renderSharedStorageUploadPlan
} = require('../lib/azure/v2-ingest-plan');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function azureIngestCommand(args = []) {
  const [subcommand = 'plan'] = args;

  if (subcommand === 'plan') {
    const dir = optionValue(args, '--dir', path.join(repoRoot, '.agentops', 'demo', 'latest'));
    const plan = buildAzureIngestPlan({ dir, allowContent: hasFlag(args, '--allow-content') });

    if (hasFlag(args, '--json')) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    } else {
      process.stdout.write(renderAzureIngestPlan(plan));
    }
    if (!plan.ok) process.exitCode = 1;
    return;
  }

  if (subcommand === 'upload-plan') {
    const dir = optionValue(args, '--dir', path.join(repoRoot, '.agentops', 'shared', 'latest'));
    const plan = buildSharedStorageUploadPlan({
      dir,
      account: optionValue(args, '--account'),
      container: optionValue(args, '--container', 'agentops-shared'),
      prefix: optionValue(args, '--prefix', 'agentops-shared')
    });

    if (hasFlag(args, '--json')) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    } else {
      process.stdout.write(renderSharedStorageUploadPlan(plan));
    }
    if (!plan.ok) process.exitCode = 1;
    return;
  }

  throw new Error('azure-ingest supports: plan, upload-plan');
}

module.exports = {
  azureIngestCommand
};
