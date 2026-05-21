#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

function usage() {
  return `agentops <command>\n\nCommands:\n  doctor [--local-only]\n  scan [--json]\n  import-jsonl <file>\n  validate-collector [endpoint]\n  validate-azure\n  link session <conversation>\n  link trace <operationId>\n  fields [--last <duration>]\n`;
}

const workspaceId = '81513958-e9aa-4a35-aeab-953e1d26e797';
const grafanaBaseUrl = 'https://graf-copilotagentops-de-a4czh7g5aueyf4e0.neu.grafana.azure.com';
const portalLogsUrl = 'https://portal.azure.com/#@/resource/subscriptions/0222a208-955a-45fd-b6d8-ca4704421bf0/resourceGroups/rg-copilot-agentops-dev/providers/Microsoft.OperationalInsights/workspaces/law-copilot-agentops-dev/logs';
const baseFilter = 'Properties has "github.copilot" and Properties has "github-copilot-cli"';
const sessionKey = 'coalesce(tostring(Properties["gen_ai.conversation.id"]), strcat(tostring(Properties["gen_ai.agent.id"]), "_", tostring(Properties["github.copilot.turn_count"]), "_", format_datetime(bin(TimeGenerated, 1h), "yyyyMMdd_HHmm")))';

function encodeGrafanaValue(value) {
  return encodeURIComponent(value);
}

function sessionQuery(conversation, last = '24h') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend conversation=${sessionKey}, operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), tool=tostring(Properties["gen_ai.tool.name"]), error=tostring(Properties["error.type"])\n| where conversation == "${conversation.replace(/"/g, '\\"')}"\n| project TimeGenerated, OperationId, ParentId, Id, Name, operation, model, tool, DurationMs, Success, ResultCode, error, Properties\n| order by TimeGenerated asc`;
}

function traceQuery(operationId, last = '24h') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| where OperationId == "${operationId.replace(/"/g, '\\"')}"\n| extend conversation=${sessionKey}, operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), tool=tostring(Properties["gen_ai.tool.name"]), error=tostring(Properties["error.type"])\n| project TimeGenerated, conversation, OperationId, ParentId, Id, Name, operation, model, tool, DurationMs, Success, ResultCode, error, Properties\n| order by TimeGenerated asc`;
}

function fieldCatalogQuery(last = '7d') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend fields = bag_keys(Properties)\n| mv-expand field = fields to typeof(string)\n| extend value = tostring(Properties[field])\n| summarize observed=count(), example_values=make_set_if(value, isnotempty(value), 5) by field\n| order by observed desc, field asc`;
}

function buildLink(kind, id, options = {}) {
  const last = options.last || '24h';
  if (kind === 'session') {
    return {
      kind,
      conversation: id,
      grafana_url: `${grafanaBaseUrl}/d/agentops-session-detail?var-conversation=${encodeGrafanaValue(id)}`,
      azure_portal_url: portalLogsUrl,
      workspace_id: workspaceId,
      query: sessionQuery(id, last)
    };
  }

  if (kind === 'trace') {
    return {
      kind,
      operation_id: id,
      grafana_url: `${grafanaBaseUrl}/d/agentops-traces-spans?var-conversation=$__all`,
      azure_portal_url: portalLogsUrl,
      workspace_id: workspaceId,
      query: traceQuery(id, last)
    };
  }

  throw new Error(`Unknown link kind: ${kind}`);
}

function parseLastArg(args, fallback = '7d') {
  const index = args.indexOf('--last');
  if (index === -1) return fallback;
  if (!args[index + 1]) throw new Error('--last requires a duration, for example 7d or 24h');
  return args[index + 1];
}

function walk(dir, predicate, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, predicate, results);
    if (entry.isFile() && predicate(fullPath)) results.push(fullPath);
  }
  return results;
}

function parseFrontmatter(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const yaml = text.slice(3, end).trim();
  const data = {};

  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    data[match[1]] = value;
  }

  return data;
}

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function repoHash() {
  const gitConfig = path.join(root, '.git', 'config');
  if (!fs.existsSync(gitConfig)) return hashText('unknown');
  const text = fs.readFileSync(gitConfig, 'utf8');
  const match = text.match(/url = (.+)/);
  return hashText(match ? match[1].trim() : 'unknown');
}

function scan() {
  const agents = walk(path.join(root, 'plugin', 'agents'), file => file.endsWith('.agent.md')).map(file => ({
    path: path.relative(root, file),
    definition_hash: hashText(fs.readFileSync(file, 'utf8')),
    ...parseFrontmatter(file)
  }));

  const skills = walk(path.join(root, 'plugin', 'skills'), file => path.basename(file) === 'SKILL.md').map(file => ({
    path: path.relative(root, file),
    definition_hash: hashText(fs.readFileSync(file, 'utf8')),
    ...parseFrontmatter(file)
  }));

  const hookPath = path.join(root, 'plugin', 'hooks.json');
  const hooks = fs.existsSync(hookPath) ? JSON.parse(fs.readFileSync(hookPath, 'utf8')) : null;

  const mcpPath = path.join(root, 'plugin', '.mcp.json');
  const mcp = fs.existsSync(mcpPath) ? JSON.parse(fs.readFileSync(mcpPath, 'utf8')) : null;

  return {
    repo_hash: repoHash(),
    timestamp: new Date().toISOString(),
    agents,
    skills,
    hooks,
    mcp_servers: mcp ? Object.keys(mcp.servers || {}) : []
  };
}

function doctor({ localOnly }) {
  const checks = [];
  const requiredFiles = [
    'copilot/copilot-observe',
    'collector/otelcol.local.yaml',
    'collector/docker-compose.yaml',
    'plugin/plugin.json',
    'plugin/hooks.json',
    'azure.yaml',
    '.azure/deployment-plan.md'
  ];

  for (const file of requiredFiles) {
    checks.push({ name: `exists:${file}`, ok: fs.existsSync(path.join(root, file)) });
  }

  const contentCapture = process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true';
  checks.push({ name: 'content-capture-disabled', ok: !contentCapture });

  const localConfig = fs.readFileSync(path.join(root, 'collector', 'otelcol.local.yaml'), 'utf8');
  checks.push({ name: 'collector-http-localhost', ok: localConfig.includes('endpoint: 127.0.0.1:4318') });
  checks.push({ name: 'collector-grpc-localhost', ok: localConfig.includes('endpoint: 127.0.0.1:4317') });

  const scanResult = scan();
  checks.push({ name: 'agents-present', ok: scanResult.agents.length >= 1 });
  checks.push({ name: 'skills-present', ok: scanResult.skills.length >= 1 });

  if (!localOnly) {
    checks.push({ name: 'azure-validation', ok: false, note: 'Run azure-validate before deployment.' });
  }

  return checks;
}

function importJsonl(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const operations = new Map();

  for (const row of rows) {
    const operation = row.name || row.operation || row.attributes?.['gen_ai.operation.name'] || 'unknown';
    operations.set(operation, (operations.get(operation) || 0) + 1);
  }

  return {
    file: filePath,
    rows: rows.length,
    operations: Object.fromEntries(operations)
  };
}

function validateCollector(endpoint = 'http://127.0.0.1:4318') {
  return new Promise((resolve) => {
    const url = new URL('/v1/traces', endpoint);
    const req = http.request(url, { method: 'POST', timeout: 1500 }, res => {
      resolve({ endpoint, reachable: true, statusCode: res.statusCode });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ endpoint, reachable: false, error: 'timeout' });
    });
    req.on('error', error => resolve({ endpoint, reachable: false, error: error.message }));
    req.end();
  });
}

async function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }

  if (command === 'scan') {
    process.stdout.write(JSON.stringify(scan(), null, 2) + '\n');
    return;
  }

  if (command === 'doctor') {
    const checks = doctor({ localOnly: args.includes('--local-only') });
    process.stdout.write(JSON.stringify({ checks, ok: checks.every(check => check.ok) }, null, 2) + '\n');
    process.exitCode = checks.every(check => check.ok) ? 0 : 1;
    return;
  }

  if (command === 'import-jsonl') {
    const filePath = args[0];
    if (!filePath) throw new Error('import-jsonl requires a file path');
    process.stdout.write(JSON.stringify(importJsonl(path.resolve(filePath)), null, 2) + '\n');
    return;
  }

  if (command === 'validate-collector') {
    process.stdout.write(JSON.stringify(await validateCollector(args[0]), null, 2) + '\n');
    return;
  }

  if (command === 'validate-azure') {
    process.stdout.write(JSON.stringify({ ok: false, next: 'Use azure-validate before deploying Azure resources.' }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  if (command === 'link') {
    const [kind, id, ...linkArgs] = args;
    if (!kind || !id) throw new Error('link requires a kind and id, for example: link session <conversation>');
    const last = parseLastArg(linkArgs, '24h');
    process.stdout.write(JSON.stringify(buildLink(kind, id, { last }), null, 2) + '\n');
    return;
  }

  if (command === 'fields') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: fieldCatalogQuery(last) }, null, 2) + '\n');
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildLink,
  doctor,
  fieldCatalogQuery,
  importJsonl,
  parseFrontmatter,
  scan,
  sessionQuery,
  traceQuery,
  validateCollector
};
