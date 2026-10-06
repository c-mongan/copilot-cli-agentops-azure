const path = require('node:path');

const { hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const {
  jsonArrayUploadFile,
  renderLogsIngestionUploadResult,
  runLogsIngestionUpload
} = require('./azure/logs-ingestion-upload');
const {
  buildAzureIngestPlan,
  buildLogsIngestionUploadPlan,
  buildSharedStorageUploadPlan,
  renderAzureIngestPlan,
  renderLogsIngestionUploadPlan,
  renderSharedStorageUploadPlan
} = require('./azure/v2-ingest-plan');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function azureIngestCommand(args = []) {
  const [subcommand = 'plan'] = args;

  if (subcommand === 'plan') {
    const dir = optionValue(args, '--dir', path.join(repoRoot, '.agentops', 'demo', 'latest'));
    const plan = buildAzureIngestPlan({ dir, allowContent: hasFlag(args, '--allow-content'), contentOnly: hasFlag(args, '--content-only'), spansOnly: hasFlag(args, '--spans-only'), eventsOnly: hasFlag(args, '--events-only') });

    writeJsonOrRender(plan, hasFlag(args, '--json'), renderAzureIngestPlan);
    if (!plan.ok) process.exitCode = 1;
    return;
  }

  if (subcommand === 'logs-upload') {
    const dir = optionValue(args, '--dir', path.join(repoRoot, '.agentops', 'demo', 'latest'));
    const plan = buildLogsIngestionUploadPlan({
      dir,
      endpoint: optionValue(args, '--endpoint', process.env.AGENTOPS_LOGS_INGESTION_ENDPOINT || ''),
      dcrImmutableId: optionValue(args, '--dcr-immutable-id', process.env.AGENTOPS_DCR_IMMUTABLE_ID || ''),
      allowContent: hasFlag(args, '--allow-content'),
      contentOnly: hasFlag(args, '--content-only'),
      spansOnly: hasFlag(args, '--spans-only'),
      eventsOnly: hasFlag(args, '--events-only')
    });
    const yes = hasFlag(args, '--yes');
    const result = yes ? runLogsIngestionUpload(plan, { deliveryLimits: optionValue(args, '--max-publish-bytes-per-day') === null ? undefined : { maxPublishBytesPerDay: /^\d+$/.test(String(optionValue(args, '--max-publish-bytes-per-day'))) ? Number(optionValue(args, '--max-publish-bytes-per-day')) : NaN } }) : plan;

    writeJsonOrRender(result, hasFlag(args, '--json'), yes ? renderLogsIngestionUploadResult : renderLogsIngestionUploadPlan);
    if (!result.ok) process.exitCode = 1;
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

    writeJsonOrRender(plan, hasFlag(args, '--json'), renderSharedStorageUploadPlan);
    if (!plan.ok) process.exitCode = 1;
    return;
  }

  throw new Error('azure-ingest supports: plan, logs-upload, upload-plan');
}

module.exports = {
  azureIngestCommand,
  jsonArrayUploadFile,
  runLogsIngestionUpload
};
