function renderSharedStorageUploadPlan(plan) {
  const lines = [];
  lines.push('AgentOps shared storage upload plan');
  lines.push('');
  lines.push(`Status: ${plan.ok ? 'ready' : 'not ready'}`);
  lines.push(`Directory: ${plan.dir}`);
  lines.push(`Storage: ${plan.storage.account || '<storage-account-name>'}/${plan.storage.container || '<container-name>'}`);
  lines.push(`Privacy scan: ${plan.privacy.ok ? 'passed' : 'failed'}`);
  lines.push('');
  lines.push('Artifacts:');
  for (const artifact of plan.artifacts) {
    lines.push(`- ${artifact.table}: ${artifact.rows === null ? 'manifest' : `${artifact.rows} row(s)`} -> ${artifact.blob}`);
  }
  if (plan.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of plan.errors) lines.push(`- ${error}`);
  }
  if (plan.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  lines.push('');
  lines.push('Commands:');
  for (const artifact of plan.artifacts) lines.push(`- ${artifact.command.join(' ')}`);
  lines.push('');
  lines.push('Next:');
  for (const command of plan.next) lines.push(`- ${command}`);
  return `${lines.join('\n')}\n`;
}

function renderAzureIngestPlan(plan) {
  const lines = [];
  lines.push('AgentOps V2 Azure ingestion plan');
  lines.push('');
  lines.push(`Status: ${plan.ok ? 'ready' : 'not ready'}`);
  lines.push(`Directory: ${plan.dir}`);
  lines.push(`Privacy scan: ${plan.privacy.ok ? 'passed' : 'failed'}`);
  lines.push(`Content rows: ${plan.content_capture.rows}${plan.content_capture.allowed ? ' (explicitly allowed)' : ''}`);
  lines.push(`Schema migration policy: ${plan.schema_migration_policy.migration_required ? 'migration required' : 'current'} (current ${plan.schema_migration_policy.current_version})`);
  lines.push('');
  lines.push('Tables:');
  for (const [table, summary] of Object.entries(plan.tables)) {
    lines.push(`- ${table}: ${summary.rows} row(s), ${summary.columns.length} column(s), stream ${summary.stream_name}`);
  }
  if (plan.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of plan.errors) lines.push(`- ${error}`);
  }
  if (plan.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  lines.push('');
  lines.push('Azure path: create Log Analytics custom tables/DCR streams for AgentOps*_CL, ingest these JSONL rows, then import the V2 Grafana dashboards.');
  lines.push('Next:');
  for (const command of plan.next) lines.push(`- ${command}`);
  return `${lines.join('\n')}\n`;
}

function renderLogsIngestionUploadPlan(plan) {
  const lines = [];
  lines.push('AgentOps Logs Ingestion upload plan');
  lines.push('');
  lines.push(`Status: ${plan.ok ? 'ready' : 'not ready'}`);
  lines.push(`Directory: ${plan.dir}`);
  lines.push(`Endpoint: ${plan.endpoint || '<logs-ingestion-endpoint>'}`);
  lines.push(`DCR immutable ID: ${plan.dcr_immutable_id || '<immutable-id>'}`);
  lines.push(`Privacy scan: ${plan.privacy.ok ? 'passed' : 'failed'}`);
  lines.push('');
  lines.push('Uploads:');
  for (const upload of plan.uploads) lines.push(`- ${upload.table}: ${upload.rows} row(s) -> ${upload.stream}`);
  if (plan.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of plan.errors) lines.push(`- ${error}`);
  }
  if (plan.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }
  lines.push('');
  lines.push('Commands:');
  for (const upload of plan.uploads) lines.push(`- ${upload.command.join(' ')}`);
  lines.push('');
  lines.push('Next:');
  for (const command of plan.next) lines.push(`- ${command}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderAzureIngestPlan,
  renderLogsIngestionUploadPlan,
  renderSharedStorageUploadPlan
};
