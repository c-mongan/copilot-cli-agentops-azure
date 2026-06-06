const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const childProcess = require('node:child_process');

const { hasFlag, optionValue } = require('../lib/args');
const {
  buildAzureIngestPlan,
  buildLogsIngestionUploadPlan,
  buildSharedStorageUploadPlan,
  renderAzureIngestPlan,
  renderLogsIngestionUploadPlan,
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

  if (subcommand === 'logs-upload') {
    const dir = optionValue(args, '--dir', path.join(repoRoot, '.agentops', 'demo', 'latest'));
    const plan = buildLogsIngestionUploadPlan({
      dir,
      endpoint: optionValue(args, '--endpoint', process.env.AGENTOPS_LOGS_INGESTION_ENDPOINT || ''),
      dcrImmutableId: optionValue(args, '--dcr-immutable-id', process.env.AGENTOPS_DCR_IMMUTABLE_ID || ''),
      allowContent: hasFlag(args, '--allow-content')
    });
    const yes = hasFlag(args, '--yes');
    const result = yes ? runLogsIngestionUpload(plan) : plan;

    if (hasFlag(args, '--json')) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(yes ? renderLogsIngestionUploadResult(result) : renderLogsIngestionUploadPlan(result));
    }
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

    if (hasFlag(args, '--json')) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    } else {
      process.stdout.write(renderSharedStorageUploadPlan(plan));
    }
    if (!plan.ok) process.exitCode = 1;
    return;
  }

  throw new Error('azure-ingest supports: plan, logs-upload, upload-plan');
}

function jsonArrayUploadFile(jsonlFile, tempDir, table) {
  const rows = fs.readFileSync(jsonlFile, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  const file = path.join(tempDir, `${table}.json`);
  fs.writeFileSync(file, `${JSON.stringify(rows)}\n`);
  return file;
}

function runLogsIngestionUpload(plan, options = {}) {
  if (!plan.ok) return { ...plan, ok: false, executed: false };
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-logs-upload-'));
  const uploads = [];

  for (const upload of plan.uploads) {
    const bodyFile = jsonArrayUploadFile(upload.file, tempDir, upload.table);
    const args = [
      'rest',
      '--method',
      'post',
      '--uri',
      upload.uri,
      '--headers',
      'Content-Type=application/json',
      '--body',
      `@${bodyFile}`
    ];
    const result = spawnSync('az', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    uploads.push({
      ...upload,
      body_file: bodyFile,
      status: result.status,
      ok: !result.error && result.status === 0,
      error: result.error ? result.error.message : '',
      stderr: result.stderr ? String(result.stderr).slice(0, 2000) : ''
    });
  }

  const ok = uploads.every(upload => upload.ok);
  return {
    ...plan,
    ok,
    executed: true,
    temp_dir: tempDir,
    uploads,
    errors: ok ? plan.errors : [
      ...plan.errors,
      ...uploads.filter(upload => !upload.ok).map(upload => `${upload.table}: az rest failed with status ${upload.status}${upload.error ? ` (${upload.error})` : ''}`)
    ]
  };
}

function renderLogsIngestionUploadResult(result) {
  const lines = [];
  lines.push('AgentOps Logs Ingestion upload');
  lines.push('');
  lines.push(`Status: ${result.ok ? 'uploaded' : 'failed'}`);
  lines.push(`Directory: ${result.dir}`);
  lines.push('');
  lines.push('Uploads:');
  for (const upload of result.uploads) {
    lines.push(`- ${upload.table}: ${upload.rows} row(s), ${upload.ok ? 'ok' : `failed status ${upload.status}`}`);
  }
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  azureIngestCommand,
  jsonArrayUploadFile,
  runLogsIngestionUpload
};
