#!/usr/bin/env node

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createAlerts } = require('./alerts');
const { createPrimitives } = require('./primitives');
const { createRecommendations } = require('./recommendations');
const { createSavedViews } = require('./saved-views');
const { createTelemetry } = require('./telemetry');

const root = path.resolve(__dirname, '..', '..');

function usage() {
  return `agentops <command>\n\nCommands:\n  status\n  latest [--file <jsonl>] [--last <duration>]\n  live|tail [--file <jsonl>] [--last <duration>] [--follow] [--interval <seconds>]\n  replay <session|latest> [--file <jsonl>] [--last <duration>]\n  explain latest [--file <jsonl>] [--last <duration>]\n  recommend latest [--file <jsonl>] [--last <duration>]\n  open [--file <jsonl>] [--last <duration>]\n  doctor [--local-only]\n  scan [--json]\n  primitives [--last <duration>] [--root <path>]\n  import-jsonl <file>\n  validate-collector [endpoint]\n  validate-azure\n  enable-shadow\n  disable-shadow\n  uninstall\n  collector start|stop\n  saved-view add <name> --url <url> [--query-file <file>] [--description <text>] [--tag <tag>]\n  saved-view list|show|open <name>\n  link session <conversation>\n  link trace <operationId>\n  fields [--last <duration>]\n  context [--last <duration>]\n  token-rollup-audit [--last <duration>]\n  permission-friction [--last <duration>]\n  alert recommend [--last <duration>]\n  lineage [--last <duration>]\n  policy [--last <duration>]\n  mcp [--last <duration>]\n  benchmark list\n  benchmark run <suite> --variant <name> --repeat <n> [--hypothesis <id>] [--dry-run]\n  benchmark report <run-id> [--azure] [--last <duration>]\n  benchmark compare <before-run-id> <after-run-id> [--azure] [--last <duration>]\n`;
}

const workspaceId = '81513958-e9aa-4a35-aeab-953e1d26e797';
const grafanaBaseUrl = 'https://graf-copilotagentops-de-a4czh7g5aueyf4e0.neu.grafana.azure.com';
const mainGrafanaDashboardUrl = `${grafanaBaseUrl}/d/copilot-agentops/copilot-cli-agentops`;
const portalLogsUrl = 'https://portal.azure.com/#@/resource/subscriptions/0222a208-955a-45fd-b6d8-ca4704421bf0/resourceGroups/rg-copilot-agentops-dev/providers/Microsoft.OperationalInsights/workspaces/law-copilot-agentops-dev/logs';
const baseFilter = 'Properties has "github.copilot" and Properties has "github-copilot-cli"';
const sessionKey = 'case(isnotempty(tostring(Properties["gen_ai.conversation.id"])), tostring(Properties["gen_ai.conversation.id"]), isnotempty(tostring(Properties["github.copilot.interaction_id"])), tostring(Properties["github.copilot.interaction_id"]), strcat(tostring(Properties["gen_ai.agent.id"]), "_", tostring(Properties["github.copilot.turn_count"]), "_", format_datetime(bin(TimeGenerated, 1h), "yyyyMMdd_HHmm")))';
const directSessionKey = 'case(isnotempty(tostring(Properties["gen_ai.conversation.id"])), tostring(Properties["gen_ai.conversation.id"]), isnotempty(tostring(Properties["github.copilot.interaction_id"])), tostring(Properties["github.copilot.interaction_id"]), "")';
const fallbackSessionKey = 'strcat(tostring(Properties["gen_ai.agent.id"]), "_", tostring(Properties["github.copilot.turn_count"]), "_", format_datetime(bin(TimeGenerated, 1h), "yyyyMMdd_HHmm"))';
const defaultInstallDir = process.env.AGENTOPS_BIN_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '', '.local', 'bin');
const benchmarksDir = path.join(root, 'benchmarks');
const benchmarkRunBaseDir = path.join(os.tmpdir(), 'agentops-benchmark-runs');
const savedViewsPath = process.env.AGENTOPS_VIEWS_PATH || path.join(os.homedir(), '.agentops', 'views.json');

function encodeGrafanaValue(value) {
  return encodeURIComponent(value);
}

function sessionQuery(conversation, last = '24h') {
  const escaped = conversation.replace(/"/g, '\\"');
  return `let selected_session = "${escaped}";\nlet base = AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend direct_session=${directSessionKey}, fallback_session=${fallbackSessionKey};\nlet selected_operations = base\n| where direct_session == selected_session or fallback_session == selected_session\n| distinct OperationId;\nbase\n| extend linked_to_selected = OperationId in (selected_operations)\n| where direct_session == selected_session or fallback_session == selected_session or linked_to_selected\n| extend conversation=iff(linked_to_selected, selected_session, iff(isnotempty(direct_session), direct_session, fallback_session)), operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), tool=tostring(Properties["gen_ai.tool.name"]), error=tostring(Properties["error.type"])\n| project TimeGenerated, conversation, OperationId, ParentId, Id, Name, operation, model, tool, DurationMs, Success, ResultCode, error, Properties\n| order by TimeGenerated asc`;
}

function traceQuery(operationId, last = '24h') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| where OperationId == "${operationId.replace(/"/g, '\\"')}"\n| extend conversation=${sessionKey}, operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), tool=tostring(Properties["gen_ai.tool.name"]), error=tostring(Properties["error.type"])\n| project TimeGenerated, conversation, OperationId, ParentId, Id, Name, operation, model, tool, DurationMs, Success, ResultCode, error, Properties\n| order by TimeGenerated asc`;
}

function fieldCatalogQuery(last = '7d') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend fields = bag_keys(Properties)\n| mv-expand field = fields to typeof(string)\n| extend value = tostring(Properties[field])\n| summarize observed=count(), example_values=make_set_if(value, isnotempty(value), 5) by field\n| order by observed desc, field asc`;
}

function contextPressureQuery(last = '7d') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend conversation=${sessionKey}, operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), agent=tostring(Properties["gen_ai.agent.name"]), tool=tostring(Properties["gen_ai.tool.name"]), repo=tostring(Properties["agentops.repo.hash"]), error=tostring(Properties["error.type"]), InputTokens=todouble(Properties["gen_ai.usage.input_tokens"]), OutputTokens=todouble(Properties["gen_ai.usage.output_tokens"]), CacheRead=todouble(Properties["gen_ai.usage.cache_read.input_tokens"]), CacheWrite=todouble(Properties["gen_ai.usage.cache_creation.input_tokens"]), Credits=todouble(Properties["github.copilot.cost"]), AIU=todouble(Properties["github.copilot.aiu"])\n| summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Spans=count(), Runs=countif(operation == "invoke_agent"), Failures=countif(Success == false or isnotempty(error)), ChatSpans=countif(operation == "chat"), ChatInputTokens=sumif(InputTokens, operation == "chat"), ChatOutputTokens=sumif(OutputTokens, operation == "chat"), ChatCacheRead=sumif(CacheRead, operation == "chat"), ChatCacheWrite=sumif(CacheWrite, operation == "chat"), ChatCredits=sumif(Credits, operation == "chat"), ChatAIU=sumif(AIU, operation == "chat"), AgentInputTokens=maxif(InputTokens, operation == "invoke_agent"), AgentOutputTokens=maxif(OutputTokens, operation == "invoke_agent"), AgentCacheRead=maxif(CacheRead, operation == "invoke_agent"), AgentCacheWrite=maxif(CacheWrite, operation == "invoke_agent"), AgentCredits=maxif(Credits, operation == "invoke_agent"), AgentAIU=maxif(AIU, operation == "invoke_agent"), P95DurationMs=percentile(DurationMs, 95), Models=make_set(model, 5), Agents=make_set(agent, 5), Repos=make_set_if(repo, isnotempty(repo), 3), Tools=make_set_if(tool, isnotempty(tool), 10), Errors=make_set_if(error, isnotempty(error), 10) by Session=conversation\n| extend InputTokens=iff(ChatSpans > 0, ChatInputTokens, AgentInputTokens), OutputTokens=iff(ChatSpans > 0, ChatOutputTokens, AgentOutputTokens), CacheRead=iff(ChatSpans > 0, ChatCacheRead, AgentCacheRead), CacheWrite=iff(ChatSpans > 0, ChatCacheWrite, AgentCacheWrite), Credits=iff(ChatSpans > 0, ChatCredits, AgentCredits), AIU=iff(ChatSpans > 0, ChatAIU, AgentAIU)\n| extend FreshInput=iff(InputTokens - CacheRead - CacheWrite < 0, 0.0, InputTokens - CacheRead - CacheWrite), OutputYieldPct=iff(InputTokens > 0, round(100.0 * OutputTokens / InputTokens, 3), 0.0), CacheLeveragePct=iff(InputTokens > 0, round(100.0 * CacheRead / InputTokens, 1), 0.0), EstUsd=round(Credits * 0.01, 4), DurationSec=round(datetime_diff("millisecond", Ended, Started) / 1000.0, 2)\n| extend Pressure=case(InputTokens >= 100000 and OutputYieldPct < 0.1, "severe_low_yield", InputTokens >= 100000, "severe_context", InputTokens >= 30000 and OutputYieldPct < 0.1, "high_low_yield", InputTokens >= 30000, "high_context", FreshInput >= 30000 and CacheLeveragePct < 10, "low_cache_leverage", EstUsd >= 1.0, "expensive", "ok")\n| where Pressure != "ok"\n| project Started, Session, Pressure, InputTokens, OutputTokens, OutputYieldPct, CacheRead, CacheWrite, FreshInput, CacheLeveragePct, Credits, EstUsd, AIU, DurationSec, P95DurationMs, Runs, Spans, Failures, Models, Agents, Repos, Tools, Errors\n| order by InputTokens desc, EstUsd desc\n| take 100`;
}

function tokenRollupAuditQuery(last = '7d') {
  return `AppDependencies\n| where TimeGenerated > ago(${last})\n| where ${baseFilter}\n| extend conversation=${sessionKey}, operation=tostring(Properties["gen_ai.operation.name"]), model=tostring(Properties["gen_ai.request.model"]), agent=tostring(Properties["gen_ai.agent.name"]), InputTokens=todouble(Properties["gen_ai.usage.input_tokens"]), OutputTokens=todouble(Properties["gen_ai.usage.output_tokens"]), CacheRead=todouble(Properties["gen_ai.usage.cache_read.input_tokens"]), CacheWrite=todouble(Properties["gen_ai.usage.cache_creation.input_tokens"]), Credits=todouble(Properties["github.copilot.cost"]), AIU=todouble(Properties["github.copilot.aiu"])\n| summarize Started=min(TimeGenerated), Ended=max(TimeGenerated), Spans=count(), ChatSpans=countif(operation == "chat"), AgentSpans=countif(operation == "invoke_agent"), AllSpanInputTokens=sum(InputTokens), AllSpanOutputTokens=sum(OutputTokens), ChatInputTokens=sumif(InputTokens, operation == "chat"), ChatOutputTokens=sumif(OutputTokens, operation == "chat"), AgentInputTokens=maxif(InputTokens, operation == "invoke_agent"), AgentOutputTokens=maxif(OutputTokens, operation == "invoke_agent"), ChatCredits=sumif(Credits, operation == "chat"), AgentCredits=maxif(Credits, operation == "invoke_agent"), ChatAIU=sumif(AIU, operation == "chat"), AgentAIU=maxif(AIU, operation == "invoke_agent"), Models=make_set(model, 5), Agents=make_set(agent, 5) by Session=conversation\n| extend RecommendedInputTokens=iff(ChatSpans > 0, ChatInputTokens, AgentInputTokens), RecommendedOutputTokens=iff(ChatSpans > 0, ChatOutputTokens, AgentOutputTokens), RecommendedCredits=iff(ChatSpans > 0, ChatCredits, AgentCredits), RecommendedAIU=iff(ChatSpans > 0, ChatAIU, AgentAIU)\n| extend TokenOvercountRatio=iff(RecommendedInputTokens > 0, round(AllSpanInputTokens / RecommendedInputTokens, 2), 0.0), RollupMode=iff(ChatSpans > 0, "chat_spans", "invoke_agent_fallback"), NeedsReview=AllSpanInputTokens > RecommendedInputTokens * 1.25\n| project Started, Ended, Session, RollupMode, NeedsReview, TokenOvercountRatio, AllSpanInputTokens, RecommendedInputTokens, AgentInputTokens, ChatInputTokens, AllSpanOutputTokens, RecommendedOutputTokens, AgentOutputTokens, ChatOutputTokens, RecommendedCredits, RecommendedAIU, Spans, ChatSpans, AgentSpans, Models, Agents\n| order by NeedsReview desc, TokenOvercountRatio desc, AllSpanInputTokens desc\n| take 100`;
}

function kqlFileQuery(fileName, last = '7d') {
  const query = fs.readFileSync(path.join(root, 'kql', fileName), 'utf8');
  return query.replace(/let lookback = [^;]+;/, `let lookback = ${last};`);
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

function validateKqlDuration(value) {
  if (!/^[1-9][0-9]*(s|m|h|d)$/.test(value)) {
    throw new Error('--last must be a duration like 30m, 24h, or 7d');
  }
  return value;
}

function escapeKqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function commandPlan(command, args = [], platform = process.platform) {
  const isWindows = platform === 'win32';
  const scriptPath = script => path.join(root, 'scripts', script);

  if (command === 'enable-shadow') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('install-copilot-agentops-shim.ps1'), '-ShadowCopilot'] }
      : { command: scriptPath('install-copilot-agentops-shim.sh'), args: ['--shadow-copilot'] };
  }

  if (command === 'disable-shadow') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('uninstall-copilot-agentops-shim.ps1'), '-KeepAgentopsCommand'] }
      : { command: scriptPath('uninstall-copilot-agentops-shim.sh'), args: ['--keep-agentops-command'] };
  }

  if (command === 'uninstall') {
    return isWindows
      ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'uninstall-agentops.ps1')] }
      : { command: path.join(root, 'uninstall-agentops.sh'), args: [] };
  }

  if (command === 'collector') {
    const action = args[0];
    if (action === 'start') {
      return isWindows
        ? { command: 'pwsh', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('collector-azuremonitor-up.ps1')] }
        : { command: scriptPath('collector-azuremonitor-up.sh'), args: [] };
    }
    if (action === 'stop') {
      return { command: 'docker', args: ['compose', '-f', path.join(root, 'collector', 'docker-compose.azuremonitor.yaml'), 'down'] };
    }
    throw new Error('collector requires start or stop');
  }

  throw new Error(`No command plan for: ${command}`);
}

function runPlannedCommand(plan) {
  let executable = plan.command;
  if (executable === 'pwsh' && process.platform === 'win32' && commandCandidates('pwsh').length === 0) {
    executable = 'powershell.exe';
  }

  const result = childProcess.spawnSync(executable, plan.args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
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

function commandCandidates(commandName) {
  const pathValue = process.env.PATH || '';
  const pathExt = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const names = process.platform === 'win32' && !path.extname(commandName)
    ? pathExt.map(ext => `${commandName}${ext.toLowerCase()}`).concat(pathExt.map(ext => `${commandName}${ext.toUpperCase()}`))
    : [commandName];
  const seen = new Set();
  const results = [];

  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
      if (seen.has(key)) continue;
      seen.add(key);
      if (fs.existsSync(candidate)) results.push(candidate);
    }
  }

  return results;
}

function installedShimStatus(installDir = defaultInstallDir) {
  const shadowName = process.platform === 'win32' ? 'copilot.cmd' : 'copilot';
  const agentopsName = process.platform === 'win32' ? 'copilot-agentops.cmd' : 'copilot-agentops';
  const shadowPath = path.join(installDir, shadowName);
  const agentopsPath = path.join(installDir, agentopsName);
  const copilotCommands = commandCandidates('copilot');
  const installDirFull = path.resolve(installDir);
  const firstCopilot = copilotCommands[0] || null;
  const shadowInstalled = fs.existsSync(shadowPath);
  const shadowFirst = firstCopilot ? path.resolve(firstCopilot).startsWith(installDirFull) : false;
  const realCopilot = copilotCommands.find(candidate => !path.resolve(candidate).startsWith(installDirFull)) || null;

  return {
    install_dir: installDir,
    copilot_agentops_installed: fs.existsSync(agentopsPath),
    copilot_agentops_path: agentopsPath,
    shadow_installed: shadowInstalled,
    shadow_path: shadowPath,
    plain_copilot_observed: shadowInstalled && shadowFirst,
    first_copilot_on_path: firstCopilot,
    real_copilot: realCopilot,
    copilot_candidates: copilotCommands
  };
}

function optionValue(args, names) {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index !== -1) {
      if (!args[index + 1]) throw new Error(`${name} requires a value`);
      return args[index + 1];
    }
  }
  return null;
}

function checkByName(checks, name) {
  return checks.find(check => check.name === name);
}

function agentopsStatusSummary({ checks = doctor({ localOnly: true }) } = {}) {
  const required = checks.filter(check => check.name.startsWith('exists:'));
  const missing = required.filter(check => !check.ok).map(check => check.name.slice('exists:'.length));
  const contentCapture = checkByName(checks, 'content-capture-disabled');
  const httpLocal = checkByName(checks, 'collector-http-localhost');
  const grpcLocal = checkByName(checks, 'collector-grpc-localhost');
  const agentopsShim = checkByName(checks, 'copilot-agentops-command');
  const shadowShim = checkByName(checks, 'plain-copilot-shadow');

  return {
    ok: checks.every(check => check.ok),
    required_files: {
      found: required.length - missing.length,
      total: required.length,
      missing
    },
    content_capture_off: Boolean(contentCapture?.ok),
    collector_localhost: Boolean(httpLocal?.ok && grpcLocal?.ok),
    shim: {
      agentops_command: agentopsShim?.status || 'unknown',
      shadow: shadowShim?.status || 'unknown',
      first_copilot_on_path: shadowShim?.first_copilot_on_path || null,
      real_copilot: shadowShim?.real_copilot || null
    }
  };
}

function renderStatus(summary = agentopsStatusSummary()) {
  const lines = [
    'AgentOps status',
    '',
    `Required files: ${summary.required_files.found} of ${summary.required_files.total} found.`
  ];

  if (summary.required_files.missing.length > 0) {
    lines.push(`Missing files: ${summary.required_files.missing.join(', ')}.`);
  }

  lines.push(summary.content_capture_off
    ? 'Content capture: off. Prompts/code were not recorded.'
    : 'Content capture: on. Turn it off before sharing telemetry.');
  lines.push(summary.collector_localhost
    ? 'Collector config: localhost for HTTP and gRPC.'
    : 'Collector config: not confirmed as localhost.');

  const agentopsCommand = summary.shim.agentops_command === 'installed' ? 'installed' : 'not installed';
  const shadow = summary.shim.shadow === 'observed'
    ? 'plain copilot is routed through AgentOps'
    : summary.shim.shadow === 'installed_not_first_on_path'
      ? 'installed, but not first on PATH'
      : summary.shim.shadow === 'not_installed'
        ? 'plain copilot shadow is not installed'
      : summary.shim.shadow.replace(/_/g, ' ');
  lines.push(`Shim: copilot-agentops is ${agentopsCommand}; ${shadow}.`);

  return `${lines.join('\n')}\n`;
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
    mcp_servers: mcp ? Object.keys(mcp.mcpServers || mcp.servers || {}) : []
  };
}

function doctor({ localOnly }) {
  const checks = [];
  const requiredFiles = [
    'copilot/copilot-observe',
    'copilot/copilot-observe.ps1',
    'collector/otelcol.local.yaml',
    'collector/docker-compose.yaml',
    'plugin/plugin.json',
    'plugin/hooks.json',
    'scripts/copilot-agentops',
    'scripts/copilot-agentops.ps1',
    'scripts/install-copilot-agentops-shim.sh',
    'scripts/install-copilot-agentops-shim.ps1',
    'scripts/uninstall-copilot-agentops-shim.sh',
    'scripts/uninstall-copilot-agentops-shim.ps1',
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

  const shim = installedShimStatus();
  checks.push({
    name: 'copilot-agentops-command',
    ok: true,
    status: shim.copilot_agentops_installed ? 'installed' : 'not_installed',
    path: shim.copilot_agentops_path
  });
  checks.push({
    name: 'plain-copilot-shadow',
    ok: true,
    status: shim.plain_copilot_observed ? 'observed' : (shim.shadow_installed ? 'installed_not_first_on_path' : 'not_installed'),
    first_copilot_on_path: shim.first_copilot_on_path,
    real_copilot: shim.real_copilot,
    shadow_path: shim.shadow_path
  });

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

function readJsonlRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function rowAttributes(row) {
  const attrs = row.attributes || row.Properties || row.properties || {};
  if (typeof attrs !== 'string') return attrs;

  try {
    return JSON.parse(attrs);
  } catch {
    return {};
  }
}

function attributeValue(attrs, keys) {
  for (const key of keys) {
    if (attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== '') return attrs[key];
  }
  return null;
}

function numberAttribute(attrs, keys) {
  const value = attributeValue(attrs, keys);
  if (value === null) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function booleanAttribute(attrs, keys) {
  const value = attributeValue(attrs, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

function operationFromRow(row, attrs) {
  return row.operation || row.name || attributeValue(attrs, ['gen_ai.operation.name', 'operation']) || 'unknown';
}

function sessionFromRow(row, attrs) {
  return row.session
    || row.Session
    || row.conversation
    || attributeValue(attrs, ['gen_ai.conversation.id', 'github.copilot.interaction_id', 'conversation'])
    || 'unknown-session';
}

function isFailedRow(row, attrs) {
  const success = row.Success ?? row.success;
  const statusCode = row.status?.code || row.statusCode || row.ResultCode || row.resultCode;
  const error = attributeValue(attrs, ['error.type', 'exception.type', 'error']);

  if (success === false || (typeof success === 'string' && success.toLowerCase() === 'false')) return true;
  if (String(statusCode || '').toUpperCase() === 'ERROR') return true;
  return Boolean(error);
}

function summarizeSession(sessionId, spans, source = 'local') {
  const tools = new Set();
  const models = new Set();
  const agents = new Set();
  const allUsage = { inputTokens: 0, outputTokens: 0, credits: 0, count: 0 };
  const chatUsage = { inputTokens: 0, outputTokens: 0, credits: 0, count: 0 };
  let toolCalls = 0;
  let failedTools = 0;
  let failures = 0;
  let policyBlocks = 0;
  let tokensRemoved = 0;
  let contentCaptureWarning = false;
  let latestTime = null;
  let earliestTime = null;

  for (const row of spans) {
    const attrs = rowAttributes(row);
    const operation = operationFromRow(row, attrs);
    const tool = attributeValue(attrs, ['gen_ai.tool.name', 'tool']);
    const model = attributeValue(attrs, ['gen_ai.request.model', 'model']);
    const agent = attributeValue(attrs, ['gen_ai.agent.name', 'agent']);
    const message = `${row.Message || row.message || row.name || ''} ${JSON.stringify(attrs)}`;
    const failed = isFailedRow(row, attrs);
    const timeValue = row.TimeGenerated || row.timestamp || row.time || row.startTime;
    const time = timeValue ? new Date(timeValue) : null;

    if (tool) tools.add(String(tool));
    if (model) models.add(String(model));
    if (agent) agents.add(String(agent));
    if (operation === 'execute_tool' || tool) {
      toolCalls += 1;
      if (failed) failedTools += 1;
    }
    if (failed) failures += 1;
    if (/preToolUse|policy|blocked|denied/i.test(message)) policyBlocks += 1;
    if (/truncation|compaction|too much context/i.test(message)) tokensRemoved += 1;
    if (booleanAttribute(attrs, ['content.capture.enabled', 'OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'])) contentCaptureWarning = true;
    if (attributeValue(attrs, ['gen_ai.prompt', 'gen_ai.completion', 'prompt', 'completion'])) contentCaptureWarning = true;

    const inputTokenValue = numberAttribute(attrs, ['gen_ai.usage.input_tokens', 'InputTokens', 'input_tokens']);
    const outputTokenValue = numberAttribute(attrs, ['gen_ai.usage.output_tokens', 'OutputTokens', 'output_tokens']);
    const creditValue = numberAttribute(attrs, ['github.copilot.cost', 'Credits', 'credits']);
    if (inputTokenValue || outputTokenValue || creditValue) {
      allUsage.inputTokens += inputTokenValue;
      allUsage.outputTokens += outputTokenValue;
      allUsage.credits += creditValue;
      allUsage.count += 1;
      if (operation === 'chat') {
        chatUsage.inputTokens += inputTokenValue;
        chatUsage.outputTokens += outputTokenValue;
        chatUsage.credits += creditValue;
        chatUsage.count += 1;
      }
    }
    tokensRemoved += numberAttribute(attrs, ['github.copilot.tokens_removed', 'tokens_removed']);

    if (time && !Number.isNaN(time.getTime())) {
      if (!latestTime || time > latestTime) latestTime = time;
      if (!earliestTime || time < earliestTime) earliestTime = time;
    }
  }

  const primaryUsage = chatUsage.count > 0 ? chatUsage : allUsage;
  const inputTokens = primaryUsage.inputTokens;
  const outputTokens = primaryUsage.outputTokens;
  const credits = primaryUsage.credits;

  const dataMissing = [];
  if (source === 'local') dataMissing.push('live Azure query');
  if (!latestTime) dataMissing.push('timestamps');
  if (inputTokens === 0 && outputTokens === 0) dataMissing.push('token totals');
  if (credits === 0) dataMissing.push('cost');

  return {
    id: sessionId,
    source,
    started: earliestTime ? earliestTime.toISOString() : null,
    ended: latestTime ? latestTime.toISOString() : null,
    spans: spans.length,
    tool_calls: toolCalls,
    failed_tools: failedTools,
    failures,
    tools: [...tools],
    models: [...models],
    agents: [...agents],
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    credits,
    est_usd: credits * 0.01,
    policy_blocks: policyBlocks,
    tokens_removed: tokensRemoved,
    content_capture_warning: contentCaptureWarning,
    grafana_url: sessionId === 'unknown-session' ? null : buildLink('session', sessionId).grafana_url,
    data_missing: dataMissing
  };
}

function latestSessionAzureQuery(last = '7d') {
  const lookback = validateKqlDuration(last);
  return `let base = AppDependencies
| where TimeGenerated > ago(${lookback})
| where ${baseFilter}
| extend direct_session=${directSessionKey}, fallback_session=${fallbackSessionKey};
let operation_sessions = base
| where isnotempty(direct_session)
| summarize operation_session=take_any(direct_session) by OperationId;
let enriched = base
| join kind=leftouter operation_sessions on OperationId
| extend conversation=iff(isnotempty(operation_session), operation_session, iff(isnotempty(direct_session), direct_session, fallback_session));
let latest_session = toscalar(enriched | summarize Ended=max(TimeGenerated) by conversation | top 1 by Ended desc | project conversation);
enriched
| where conversation == latest_session
| project TimeGenerated, conversation, Name, Success, ResultCode, DurationMs, OperationId, ParentId, Id, Properties
| order by TimeGenerated asc`;
}

function runAzureLogAnalyticsQuery(query, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const result = spawnSync('az', [
    'monitor',
    'log-analytics',
    'query',
    '--workspace',
    options.workspaceId || workspaceId,
    '--analytics-query',
    query,
    '-o',
    'json'
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });

  if (result.error) return { ok: false, rows: [], error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      rows: [],
      error: (result.stderr || result.stdout || `az exited with status ${result.status}`).trim()
    };
  }

  try {
    return { ok: true, rows: JSON.parse(result.stdout || '[]'), error: null };
  } catch (error) {
    return { ok: false, rows: [], error: `Could not parse Azure query JSON: ${error.message}` };
  }
}

function latestAzureSessionSummary(options = {}) {
  const last = validateKqlDuration(options.last || '7d');
  const query = latestSessionAzureQuery(last);
  const result = runAzureLogAnalyticsQuery(query, options);

  if (!result.ok) {
    return {
      mode: 'azure',
      last,
      query,
      session: null,
      error: result.error,
      data_missing: ['live Azure query failed']
    };
  }

  if (!Array.isArray(result.rows) || result.rows.length === 0) {
    return {
      mode: 'azure',
      last,
      query,
      session: null,
      data_missing: [`no Copilot telemetry found in Azure for last ${last}`]
    };
  }

  return {
    ...latestSessionSummary({ rows: result.rows, source: 'azure' }),
    last,
    query
  };
}

function latestSessionSummary({ filePath = null, rows = null, source = null } = {}) {
  if (!filePath && !rows) {
    return {
      mode: 'missing-live',
      session: null,
      data_missing: ['live Azure query', 'local JSONL file', 'latest session id', 'token totals', 'cost']
    };
  }

  const sourceRows = rows || readJsonlRows(filePath);
  const summarySource = source || (filePath ? 'local' : 'azure');
  const sessions = new Map();
  const order = [];
  let currentSessionId = null;

  for (const row of sourceRows) {
    const attrs = rowAttributes(row);
    let sessionId = sessionFromRow(row, attrs);
    if (sessionId === 'unknown-session' && currentSessionId) sessionId = currentSessionId;
    if (sessionId !== 'unknown-session') currentSessionId = sessionId;
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, []);
      order.push(sessionId);
    }
    sessions.get(sessionId).push(row);
  }

  const summaries = order.map(sessionId => summarizeSession(sessionId, sessions.get(sessionId), summarySource));
  const withTime = summaries.filter(summary => summary.ended);
  const session = withTime.length > 0
    ? withTime.sort((a, b) => new Date(b.ended) - new Date(a.ended))[0]
    : summaries.at(-1) || null;

  return {
    mode: summarySource,
    file: filePath,
    session,
    data_missing: session ? session.data_missing : ['local JSONL rows']
  };
}

function listOrMissing(values, missing = 'not in this data') {
  return values.length > 0 ? values.join(', ') : missing;
}

function renderLatest(summary = latestSessionSummary()) {
  const lines = ['Latest Copilot session', ''];

  if (!summary.session) {
    if (summary.mode === 'azure' && summary.error) {
      lines.push('I could not read live Azure telemetry.');
      lines.push(`Azure error: ${summary.error}`);
      lines.push('Use --file <jsonl> to summarize a local or fixture export.');
    } else if (summary.mode === 'azure') {
      lines.push(`No Copilot sessions were found in Azure for the last ${summary.last || '7d'}.`);
      lines.push('Run Copilot through AgentOps, then try again.');
    } else {
      lines.push('Use --file <jsonl> to summarize a local or fixture export, or run with Azure CLI access for live telemetry.');
    }
    lines.push(`Missing data: ${summary.data_missing.join(', ')}.`);
    lines.push(`Main dashboard: ${mainGrafanaDashboardUrl}`);
    return `${lines.join('\n')}\n`;
  }

  const session = summary.session;
  lines.push(`Session: ${session.id}`);
  lines.push(`What happened: ${session.spans} spans, ${session.tool_calls} tool call${session.tool_calls === 1 ? '' : 's'}, ${session.failures} failure${session.failures === 1 ? '' : 's'}.`);
  lines.push(`Tools: ${listOrMissing(session.tools)}.`);
  lines.push(`Model: ${listOrMissing(session.models)}.`);
  lines.push(session.est_usd > 0 ? `Estimated cost: $${session.est_usd.toFixed(2)}.` : 'Estimated cost: not in this data.');
  lines.push(session.content_capture_warning
    ? 'Privacy: content capture may be on. Do not share this export until reviewed.'
    : 'Privacy: prompts/code were not recorded in this summary.');
  if (session.grafana_url) lines.push(`Grafana session: ${session.grafana_url}`);
  if (session.data_missing.length > 0) lines.push(`Data missing: ${session.data_missing.join(', ')}.`);

  return `${lines.join('\n')}\n`;
}

function explainLatest(summary = latestSessionSummary()) {
  const session = summary.session;
  if (!session) {
    return {
      classification: 'unknown',
      headline: 'Not enough data yet',
      detail: summary.mode === 'azure' && summary.error
        ? `The Azure query failed: ${summary.error}`
        : 'No local JSONL rows or live Azure rows were available.',
      session: null
    };
  }

  if (session.content_capture_warning) {
    return {
      classification: 'content_capture_warning',
      headline: 'Content capture warning',
      detail: 'Prompts or code may have been recorded. Review the export before sharing it.',
      session
    };
  }

  if (session.policy_blocks > 0) {
    return {
      classification: 'policy_blocked',
      headline: 'No risky commands were allowed through',
      detail: `${session.policy_blocks} policy signal${session.policy_blocks === 1 ? '' : 's'} appeared in this session.`,
      session
    };
  }

  if (session.failed_tools > 0) {
    return {
      classification: 'failed_tool',
      headline: 'Tools kept failing',
      detail: `${session.failed_tools} tool call${session.failed_tools === 1 ? '' : 's'} failed. Check the tool waterfall in Grafana.`,
      session
    };
  }

  if (session.input_tokens >= 30000 || session.tokens_removed > 0) {
    return {
      classification: 'too_much_context',
      headline: 'Copilot had too much to remember',
      detail: 'The session shows high context use or compaction/truncation signals.',
      session
    };
  }

  if (session.est_usd >= 1) {
    return {
      classification: 'high_cost',
      headline: 'This session looked expensive',
      detail: `Estimated cost was $${session.est_usd.toFixed(2)}.`,
      session
    };
  }

  if (session.spans > 0 && session.failures === 0) {
    return {
      classification: 'success',
      headline: 'This session looks successful',
      detail: 'No failed tools, policy blocks, high context, or high cost signals were found.',
      session
    };
  }

  return {
    classification: 'unknown',
    headline: 'The issue is unclear',
    detail: 'The local data does not include enough signals to classify the session.',
    session
  };
}

function renderExplanation(explanation = explainLatest()) {
  const lines = ['Likely issue', '', explanation.headline, explanation.detail];
  if (explanation.session?.grafana_url) lines.push(`Open in Grafana: ${explanation.session.grafana_url}`);
  return `${lines.join('\n')}\n`;
}

function openLinksSummary(summary = latestSessionSummary()) {
  return {
    main_dashboard_url: mainGrafanaDashboardUrl,
    latest_session_url: summary.session?.grafana_url || null,
    missing_latest_reason: summary.session
      ? 'that session did not include a usable session id'
      : 'latest session was not found in the selected local file or Azure lookback window'
  };
}

function latestSummaryFromArgs(args, fallbackLast = '7d') {
  const filePath = optionValue(args, ['--file', '--jsonl']);
  if (filePath) return latestSessionSummary({ filePath: path.resolve(filePath) });

  return latestAzureSessionSummary({ last: parseLastArg(args, fallbackLast) });
}

const {
  alertRecommendationQuery,
  alertRecommendations
} = createAlerts({
  workspaceId,
  baseFilter,
  sessionKey,
  validateKqlDuration
});

const {
  recommendationForExplanation,
  renderRecommendation
} = createRecommendations({
  buildLink,
  mainGrafanaDashboardUrl,
  latestSessionAzureQuery
});

const {
  copilotPrimitivesInventory
} = createPrimitives({
  root,
  workspaceId,
  kqlFileQuery,
  validateKqlDuration,
  optionValue
});

const {
  liveViewFromArgs,
  replayTimeline,
  renderLive,
  renderReplay,
  sleep,
  spanRowsFromSource
} = createTelemetry({
  optionValue,
  parseLastArg,
  readJsonlRows,
  validateKqlDuration,
  latestSessionAzureQuery,
  runAzureLogAnalyticsQuery,
  rowAttributes,
  operationFromRow,
  attributeValue,
  numberAttribute,
  isFailedRow,
  sessionFromRow,
  numberValue,
  roundNumber
});

const {
  parseSavedViewArgs,
  readSavedViews,
  savedViewCommand
} = createSavedViews({
  savedViewsPath,
  readJson,
  buildLink
});

function renderOpenLinks(links = openLinksSummary()) {
  const lines = [
    'Grafana links',
    '',
    `Main dashboard: ${links.main_dashboard_url}`
  ];

  if (links.latest_session_url) {
    lines.push(`Latest session: ${links.latest_session_url}`);
  } else {
    lines.push(`Latest session: unknown. ${links.missing_latest_reason}.`);
  }

  return `${lines.join('\n')}\n`;
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function validateBenchmarkTask(task, suiteDir, source = 'task') {
  const errors = [];
  const stringFields = ['id', 'title', 'fixture', 'prompt'];
  const arrayFields = ['copilotArgs', 'successCommands', 'expectedFiles', 'forbiddenFiles', 'tags'];

  for (const field of stringFields) {
    if (typeof task[field] !== 'string' || task[field].trim() === '') {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  for (const field of arrayFields) {
    if (!isStringArray(task[field])) {
      errors.push(`${field} must be an array of strings`);
    }
  }

  if (!Number.isInteger(task.timeoutSec) || task.timeoutSec <= 0) {
    errors.push('timeoutSec must be a positive integer');
  }

  const fixturePath = typeof task.fixture === 'string' ? path.resolve(suiteDir, task.fixture) : null;
  if (fixturePath && (!fs.existsSync(fixturePath) || !fs.statSync(fixturePath).isDirectory())) {
    errors.push(`fixture does not exist: ${task.fixture}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid benchmark task ${source}: ${errors.join('; ')}`);
  }

  return {
    ...task,
    fixturePath,
    source
  };
}

function loadBenchmarkSuites(baseDir = benchmarksDir) {
  if (!fs.existsSync(baseDir)) return [];

  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const suiteDir = path.join(baseDir, entry.name);
      const suitePath = path.join(suiteDir, 'suite.json');
      const metadata = fs.existsSync(suitePath) ? readJson(suitePath) : {};
      const tasksDir = path.join(suiteDir, 'tasks');
      const taskFiles = fs.existsSync(tasksDir)
        ? fs.readdirSync(tasksDir).filter(file => file.endsWith('.json')).sort()
        : [];
      const tasks = taskFiles.map(file => {
        const taskPath = path.join(tasksDir, file);
        return validateBenchmarkTask(readJson(taskPath), suiteDir, path.relative(root, taskPath));
      });

      return {
        id: metadata.id || entry.name,
        title: metadata.title || entry.name,
        description: metadata.description || '',
        path: path.relative(root, suiteDir),
        tasks
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function listBenchmarks(baseDir = benchmarksDir) {
  return {
    suites: loadBenchmarkSuites(baseDir).map(suite => ({
      id: suite.id,
      title: suite.title,
      description: suite.description,
      path: suite.path,
      tasks: suite.tasks.map(task => ({
        id: task.id,
        title: task.title,
        fixture: task.fixture,
        timeoutSec: task.timeoutSec,
        tags: task.tags
      }))
    }))
  };
}

function parseBenchmarkRunArgs(args) {
  const suite = args[0];
  if (!suite) throw new Error('benchmark run requires a suite');

  const options = {
    suite,
    repeat: 1,
    dryRun: false
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--variant') {
      options.variant = args[index + 1];
      index += 1;
    } else if (arg === '--repeat') {
      options.repeat = Number(args[index + 1]);
      index += 1;
    } else if (arg === '--hypothesis') {
      options.hypothesis = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark run option: ${arg}`);
    }
  }

  if (!options.variant) throw new Error('benchmark run requires --variant <name>');
  if (!Number.isInteger(options.repeat) || options.repeat <= 0) {
    throw new Error('--repeat must be a positive integer');
  }

  return options;
}

function parseBenchmarkReportArgs(args) {
  const runId = args[0];
  if (!runId) throw new Error('benchmark report requires a run id');

  const options = {
    runId,
    azure: false,
    last: '24h'
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--azure') {
      options.azure = true;
    } else if (arg === '--last') {
      if (!args[index + 1]) throw new Error('--last requires a duration, for example 7d or 24h');
      options.last = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark report option: ${arg}`);
    }
  }

  if (options.azure) validateKqlDuration(options.last);
  return options;
}

function parseBenchmarkCompareArgs(args) {
  const beforeRunId = args[0];
  const afterRunId = args[1];
  if (!beforeRunId || !afterRunId) throw new Error('benchmark compare requires before and after run ids');

  const options = {
    beforeRunId,
    afterRunId,
    azure: false,
    last: '24h'
  };

  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--azure') {
      options.azure = true;
    } else if (arg === '--last') {
      if (!args[index + 1]) throw new Error('--last requires a duration, for example 7d or 24h');
      options.last = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown benchmark compare option: ${arg}`);
    }
  }

  if (options.azure) validateKqlDuration(options.last);
  return options;
}

function makeBenchmarkRunId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `bench-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function benchmarkRunPlan(suiteId, options = {}) {
  const variant = options.variant;
  const repeat = options.repeat || 1;
  const dryRun = Boolean(options.dryRun);
  const hypothesis = options.hypothesis || null;

  if (!variant) throw new Error('benchmark run requires --variant <name>');
  if (!Number.isInteger(repeat) || repeat <= 0) throw new Error('--repeat must be a positive integer');

  const suite = loadBenchmarkSuites(options.benchmarksDir || benchmarksDir).find(item => item.id === suiteId);
  if (!suite) throw new Error(`Unknown benchmark suite: ${suiteId}`);

  const runId = options.runId || makeBenchmarkRunId(options.now);
  const runs = [];

  for (let repeatIndex = 1; repeatIndex <= repeat; repeatIndex += 1) {
    for (const task of suite.tasks) {
      const runRoot = path.join(benchmarkRunBaseDir, runId, task.id, `repeat-${repeatIndex}`);
      runs.push({
        taskId: task.id,
        taskTitle: task.title,
        repeat: repeatIndex,
        copiedFixturePath: {
          from: task.fixturePath,
          to: path.join(runRoot, 'workspace')
        },
        copilotHome: path.join(runRoot, 'copilot-home'),
        environment: {
          COPILOT_HOME: path.join(runRoot, 'copilot-home')
        },
        copilot: {
          command: 'copilot',
          args: task.copilotArgs,
          prompt: task.prompt
        },
        otelLabels: {
          'agentops.benchmark.run_id': runId,
          'agentops.benchmark.suite': suite.id,
          'agentops.benchmark.task_id': task.id,
          'agentops.benchmark.variant': variant,
          'agentops.benchmark.repeat': String(repeatIndex),
          ...(hypothesis ? { 'agentops.hypothesis.id': hypothesis } : {})
        },
        successChecks: {
          commands: task.successCommands,
          expectedFiles: task.expectedFiles,
          forbiddenFiles: task.forbiddenFiles
        },
        timeoutSec: task.timeoutSec
      });
    }
  }

  return {
    runId,
    suite: suite.id,
    variant,
    hypothesis,
    repeat,
    dryRun,
    wouldMutateRepo: !dryRun,
    wouldExecuteCopilot: !dryRun,
    runs
  };
}

function safeBenchmarkPath(baseDir, relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error(`Benchmark path must be relative: ${relativePath}`);
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Benchmark path cannot leave the workspace: ${relativePath}`);
  }
  return path.resolve(baseDir, normalized);
}

function relativeFileSnapshot(dir) {
  const snapshot = new Map();
  if (!fs.existsSync(dir)) return snapshot;

  for (const file of walk(dir, item => fs.statSync(item).isFile())) {
    snapshot.set(path.relative(dir, file), hashText(fs.readFileSync(file)));
  }

  return snapshot;
}

function changedRelativeFiles(before, after) {
  const files = new Set([...before.keys(), ...after.keys()]);
  return [...files].filter(file => before.get(file) !== after.get(file)).sort();
}

function commandSucceeded(result) {
  return Boolean(result) && !result.error && result.status === 0;
}

function commandFailureMessage(result) {
  if (!result) return 'command did not run';
  if (result.error) return result.error.message;
  if (result.signal) return `terminated by ${result.signal}`;
  return `exited with status ${result.status}`;
}

function runShellCheck(command, cwd, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
  return spawnSync(shell, args, {
    cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs || 10000,
    maxBuffer: 1024 * 1024
  });
}

function outputText(value) {
  if (value === undefined || value === null) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function escapeResourceAttributeValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/,/g, '\\,');
}

function mergeResourceAttributes(existing, labels) {
  const benchmarkLabels = Object.entries(labels)
    .map(([key, value]) => `${key}=${escapeResourceAttributeValue(value)}`)
    .join(',');
  return [existing, benchmarkLabels].filter(Boolean).join(',');
}

function benchmarkErrorCategory(copilotResult, checkResults, forbiddenFilesChanged) {
  if (copilotResult?.error?.code === 'ETIMEDOUT' || copilotResult?.signal) return 'timeout';
  if (!commandSucceeded(copilotResult)) return 'copilot_failed';
  if (forbiddenFilesChanged > 0) return 'safety_violation';
  if (checkResults.some(check => !check.ok)) return 'assertion_failure';
  return null;
}

function executeBenchmarkRun(plan, run, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const runRoot = path.dirname(run.copiedFixturePath.to);
  const workspace = run.copiedFixturePath.to;

  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.mkdirSync(runRoot, { recursive: true });
  fs.cpSync(run.copiedFixturePath.from, workspace, { recursive: true });
  fs.mkdirSync(run.copilotHome, { recursive: true });

  const beforeSnapshot = relativeFileSnapshot(workspace);
  const env = {
    ...process.env,
    ...run.environment,
    AGENTOPS_BENCHMARK_RUN_ID: plan.runId,
    AGENTOPS_BENCHMARK_SUITE: plan.suite,
    AGENTOPS_BENCHMARK_TASK_ID: run.taskId,
    AGENTOPS_BENCHMARK_VARIANT: plan.variant,
    AGENTOPS_BENCHMARK_REPEAT: String(run.repeat),
    ...(plan.hypothesis ? { AGENTOPS_HYPOTHESIS_ID: plan.hypothesis } : {})
  };
  env.OTEL_RESOURCE_ATTRIBUTES = mergeResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES, run.otelLabels);

  const startedAt = new Date();
  const copilotResult = spawnSync(options.copilotCommand || run.copilot.command, [...run.copilot.args, '-p', run.copilot.prompt], {
    cwd: workspace,
    env,
    encoding: 'utf8',
    timeout: run.timeoutSec * 1000,
    maxBuffer: 10 * 1024 * 1024
  });
  const endedAt = new Date();

  fs.writeFileSync(path.join(runRoot, 'stdout.txt'), outputText(copilotResult?.stdout));
  fs.writeFileSync(path.join(runRoot, 'stderr.txt'), outputText(copilotResult?.stderr));

  const checkResults = [{
    name: 'copilot exited 0',
    ok: commandSucceeded(copilotResult),
    detail: commandSucceeded(copilotResult) ? null : commandFailureMessage(copilotResult)
  }];

  for (const command of run.successChecks.commands) {
    const result = runShellCheck(command, workspace, { spawnSync });
    checkResults.push({
      name: `command: ${command}`,
      ok: commandSucceeded(result),
      detail: commandSucceeded(result) ? null : commandFailureMessage(result)
    });
  }

  for (const file of run.successChecks.expectedFiles) {
    checkResults.push({
      name: `expected file: ${file}`,
      ok: fs.existsSync(safeBenchmarkPath(workspace, file)),
      detail: null
    });
  }

  for (const file of run.successChecks.forbiddenFiles) {
    checkResults.push({
      name: `forbidden file absent: ${file}`,
      ok: !fs.existsSync(safeBenchmarkPath(workspace, file)),
      detail: null
    });
  }

  const afterSnapshot = relativeFileSnapshot(workspace);
  const changedFiles = changedRelativeFiles(beforeSnapshot, afterSnapshot);
  const forbiddenFilesChanged = run.successChecks.forbiddenFiles
    .filter(file => beforeSnapshot.get(path.normalize(file)) !== afterSnapshot.get(path.normalize(file)))
    .length;
  const checksPassed = checkResults.filter(check => check.ok).length;
  const checksFailed = checkResults.length - checksPassed;
  const errorCategory = benchmarkErrorCategory(copilotResult, checkResults, forbiddenFilesChanged);

  return {
    runId: plan.runId,
    suite: plan.suite,
    variant: plan.variant,
    hypothesis: plan.hypothesis,
    taskId: run.taskId,
    taskTitle: run.taskTitle,
    repeat: run.repeat,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    success: checksFailed === 0 && forbiddenFilesChanged === 0,
    checksPassed,
    checksFailed,
    filesChanged: changedFiles.length,
    changedFiles,
    forbiddenFilesChanged,
    toolFailures: 0,
    policyBlocks: 0,
    contentCaptureDetected: process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true',
    inputTokens: 0,
    outputTokens: 0,
    aiu: 0,
    cost: 0,
    errorCategory,
    checks: checkResults,
    workspace,
    stdoutPath: path.join(runRoot, 'stdout.txt'),
    stderrPath: path.join(runRoot, 'stderr.txt')
  };
}

function runBenchmarkSuite(suiteId, options = {}) {
  const plan = benchmarkRunPlan(suiteId, options);
  if (plan.dryRun) return plan;

  const summaries = plan.runs.map(run => executeBenchmarkRun(plan, run, options));
  const summariesDir = options.summariesDir || defaultBenchmarkSummaryDir();
  fs.mkdirSync(summariesDir, { recursive: true });
  const summariesPath = path.join(summariesDir, `${plan.runId}.json`);
  fs.writeFileSync(summariesPath, `${JSON.stringify(summaries, null, 2)}\n`);

  return {
    ...plan,
    summariesPath,
    summaries,
    report: benchmarkReport(plan.runId, summaries)
  };
}

function benchmarkAzureTelemetryQuery(runId, last = '24h') {
  const lookback = validateKqlDuration(last);
  const escapedRunId = escapeKqlString(runId);
  return `AppDependencies
| where TimeGenerated > ago(${lookback})
| where Properties has "${escapedRunId}"
| extend run_id=tostring(Properties["agentops.benchmark.run_id"]),
    suite=tostring(Properties["agentops.benchmark.suite"]),
    task_id=tostring(Properties["agentops.benchmark.task_id"]),
    variant=tostring(Properties["agentops.benchmark.variant"]),
    hypothesis=tostring(Properties["agentops.hypothesis.id"]),
    repeat_id=tostring(Properties["agentops.benchmark.repeat"]),
    conversation=tostring(Properties["gen_ai.conversation.id"]),
    operation=tostring(Properties["gen_ai.operation.name"]),
    model=tostring(Properties["gen_ai.request.model"]),
    tool=tostring(Properties["gen_ai.tool.name"]),
    error=tostring(Properties["error.type"]),
    InputTokens=todouble(Properties["gen_ai.usage.input_tokens"]),
    OutputTokens=todouble(Properties["gen_ai.usage.output_tokens"]),
    CacheRead=todouble(Properties["gen_ai.usage.cache_read.input_tokens"]),
    CacheWrite=todouble(Properties["gen_ai.usage.cache_creation.input_tokens"]),
    Credits=todouble(Properties["github.copilot.cost"]),
    AIU=todouble(Properties["github.copilot.aiu"])
| where run_id == "${escapedRunId}"
| summarize Started=min(TimeGenerated),
    Ended=max(TimeGenerated),
    Spans=count(),
    ChatSpans=countif(operation == "chat"),
    AgentSpans=countif(operation == "invoke_agent"),
    ToolCalls=countif(operation == "execute_tool" or isnotempty(tool)),
    ToolFailures=countif((operation == "execute_tool" or isnotempty(tool)) and (Success == false or tostring(Success) =~ "false" or isnotempty(error))),
    Failures=countif(Success == false or tostring(Success) =~ "false" or isnotempty(error)),
    ChatInputTokens=sumif(InputTokens, operation == "chat"),
    ChatOutputTokens=sumif(OutputTokens, operation == "chat"),
    ChatCacheRead=sumif(CacheRead, operation == "chat"),
    ChatCacheWrite=sumif(CacheWrite, operation == "chat"),
    ChatCredits=sumif(Credits, operation == "chat"),
    ChatAIU=sumif(AIU, operation == "chat"),
    AgentInputTokens=maxif(InputTokens, operation == "invoke_agent"),
    AgentOutputTokens=maxif(OutputTokens, operation == "invoke_agent"),
    AgentCacheRead=maxif(CacheRead, operation == "invoke_agent"),
    AgentCacheWrite=maxif(CacheWrite, operation == "invoke_agent"),
    AgentCredits=maxif(Credits, operation == "invoke_agent"),
    AgentAIU=maxif(AIU, operation == "invoke_agent"),
    Models=make_set_if(model, isnotempty(model), 5),
    Tools=make_set_if(tool, isnotempty(tool), 10),
    Conversations=make_set_if(conversation, isnotempty(conversation), 5),
    Operations=make_set_if(operation, isnotempty(operation), 10)
    by run_id, suite, task_id, variant, hypothesis, repeat_id
| extend InputTokens=iff(ChatSpans > 0, ChatInputTokens, AgentInputTokens),
    OutputTokens=iff(ChatSpans > 0, ChatOutputTokens, AgentOutputTokens),
    CacheRead=iff(ChatSpans > 0, ChatCacheRead, AgentCacheRead),
    CacheWrite=iff(ChatSpans > 0, ChatCacheWrite, AgentCacheWrite),
    Credits=iff(ChatSpans > 0, ChatCredits, AgentCredits),
    AIU=iff(ChatSpans > 0, ChatAIU, AgentAIU)
| order by task_id asc, repeat_id asc`;
}

function arrayFromAzureValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeBenchmarkTelemetryRow(row) {
  const credits = numberValue(row.Credits);
  const aiuRaw = numberValue(row.AIU);
  return {
    runId: row.run_id || row.RunId || row.runId,
    suite: row.suite || row.Suite || '',
    taskId: row.task_id || row.taskId || '',
    variant: row.variant || row.Variant || '',
    hypothesis: row.hypothesis || row.Hypothesis || '',
    repeat: row.repeat_id || row.repeat || '',
    startedAt: row.Started || row.startedAt || null,
    endedAt: row.Ended || row.endedAt || null,
    spans: numberValue(row.Spans),
    toolCalls: numberValue(row.ToolCalls),
    toolFailures: numberValue(row.ToolFailures),
    failures: numberValue(row.Failures),
    inputTokens: numberValue(row.InputTokens),
    outputTokens: numberValue(row.OutputTokens),
    cacheReadTokens: numberValue(row.CacheRead),
    cacheWriteTokens: numberValue(row.CacheWrite),
    credits,
    cost: roundNumber(credits * 0.01, 4),
    aiu: normalizeAiuValue(aiuRaw),
    aiuRaw,
    models: arrayFromAzureValue(row.Models),
    tools: arrayFromAzureValue(row.Tools),
    conversations: arrayFromAzureValue(row.Conversations),
    operations: arrayFromAzureValue(row.Operations)
  };
}

function benchmarkTelemetryKey(taskId, repeat) {
  return `${taskId || ''}::${repeat === undefined || repeat === null ? '' : String(repeat)}`;
}

function benchmarkAzureTelemetry(runId, options = {}) {
  const last = validateKqlDuration(options.last || '24h');
  const query = benchmarkAzureTelemetryQuery(runId, last);
  const result = runAzureLogAnalyticsQuery(query, options);

  if (!result.ok) {
    return {
      requested: true,
      ok: false,
      last,
      query,
      error: result.error,
      rows: [],
      matchedSpans: 0,
      matchedTasks: 0
    };
  }

  const rows = Array.isArray(result.rows) ? result.rows.map(normalizeBenchmarkTelemetryRow) : [];
  return {
    requested: true,
    ok: rows.length > 0,
    last,
    query,
    rows,
    matchedSpans: rows.reduce((total, row) => total + row.spans, 0),
    matchedTasks: rows.filter(row => row.taskId).length,
    data_missing: rows.length > 0 ? [] : ['azure benchmark telemetry']
  };
}

function enrichBenchmarkSummariesWithAzure(runId, summaries, options = {}) {
  const telemetry = benchmarkAzureTelemetry(runId, options);
  if (!telemetry.ok) return { summaries, azureTelemetry: telemetry };

  const byTaskAndRepeat = new Map();
  const byTask = new Map();
  for (const row of telemetry.rows) {
    byTaskAndRepeat.set(benchmarkTelemetryKey(row.taskId, row.repeat), row);
    if (!byTask.has(row.taskId)) byTask.set(row.taskId, []);
    byTask.get(row.taskId).push(row);
  }

  const enriched = summaries.map(summary => {
    const repeat = summary.repeat === undefined || summary.repeat === null ? '' : summary.repeat;
    const exact = byTaskAndRepeat.get(benchmarkTelemetryKey(summary.taskId, repeat));
    const taskRows = byTask.get(summary.taskId) || [];
    const row = exact || (taskRows.length === 1 ? taskRows[0] : null);
    if (!row) return { ...summary, telemetryMatched: false };

    return {
      ...summary,
      telemetryMatched: true,
      telemetrySource: 'azure',
      azureSpans: row.spans,
      azureToolCalls: row.toolCalls,
      azureFailures: row.failures,
      startedAt: summary.startedAt || row.startedAt,
      endedAt: summary.endedAt || row.endedAt,
      toolFailures: Math.max(numberValue(summary.toolFailures), row.toolFailures),
      hypothesis: summary.hypothesis || row.hypothesis || null,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      credits: row.credits,
      cost: row.cost,
      aiu: row.aiu,
      aiuRaw: row.aiuRaw,
      models: row.models,
      tools: row.tools,
      conversations: row.conversations,
      operations: row.operations,
      errorCategory: summary.errorCategory || (row.toolFailures > 0 ? 'tool_failure' : null)
    };
  });

  return {
    summaries: enriched,
    azureTelemetry: {
      requested: true,
      ok: true,
      last: telemetry.last,
      matchedSpans: telemetry.matchedSpans,
      matchedTasks: enriched.filter(summary => summary.telemetryMatched).length,
      unmatchedTasks: enriched.filter(summary => !summary.telemetryMatched).map(summary => summary.taskId),
      query: telemetry.query
    }
  };
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAiuValue(value) {
  const aiu = numberValue(value);
  return Math.abs(aiu) >= 1000000 ? roundNumber(aiu / 1000000000, 3) : aiu;
}

function roundNumber(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreBenchmarkSummary(summary) {
  const checksPassed = numberValue(summary.checksPassed);
  const checksFailed = numberValue(summary.checksFailed);
  const totalChecks = checksPassed + checksFailed;
  const checkRate = totalChecks > 0 ? checksPassed / totalChecks : (summary.success ? 1 : 0);
  const forbiddenFilesChanged = numberValue(summary.forbiddenFilesChanged);
  const toolFailures = numberValue(summary.toolFailures);
  const policyBlocks = numberValue(summary.policyBlocks);
  const totalTokens = numberValue(summary.inputTokens) + numberValue(summary.outputTokens);
  const cost = numberValue(summary.cost);
  const penalties = [];

  let score = (summary.success ? 40 : 0) + (checkRate * 40) + 20;

  if (forbiddenFilesChanged > 0) {
    penalties.push({ reason: 'forbidden files changed', points: Math.min(40, 25 + (forbiddenFilesChanged * 5)) });
  }
  if (policyBlocks > 0) {
    penalties.push({ reason: 'policy blocks', points: Math.min(40, 25 + (policyBlocks * 5)) });
  }
  if (summary.contentCaptureDetected === true) {
    penalties.push({ reason: 'content capture detected', points: 30 });
  }
  if (toolFailures > 0) {
    penalties.push({ reason: 'tool failures', points: Math.min(16, toolFailures * 4) });
  }
  if (String(summary.errorCategory || '').toLowerCase() === 'timeout') {
    penalties.push({ reason: 'timeout', points: 10 });
  }
  if (totalTokens > 500000) {
    penalties.push({ reason: 'very high token use', points: 15 });
  } else if (totalTokens > 200000) {
    penalties.push({ reason: 'high token use', points: 10 });
  } else if (totalTokens > 100000) {
    penalties.push({ reason: 'elevated token use', points: 5 });
  }
  if (cost > 20) {
    penalties.push({ reason: 'very high cost', points: 15 });
  } else if (cost > 5) {
    penalties.push({ reason: 'high cost', points: 10 });
  } else if (cost > 1) {
    penalties.push({ reason: 'elevated cost', points: 5 });
  }

  for (const penalty of penalties) score -= penalty.points;

  return {
    ...summary,
    score: roundNumber(Math.max(0, Math.min(100, score))),
    checkRate: roundNumber(checkRate, 3),
    safetyViolation: forbiddenFilesChanged > 0 || policyBlocks > 0 || summary.contentCaptureDetected === true,
    penalties
  };
}

function topFailureCategories(scoredSummaries) {
  const counts = new Map();

  for (const summary of scoredSummaries) {
    if (!summary.success && summary.errorCategory) {
      counts.set(summary.errorCategory, (counts.get(summary.errorCategory) || 0) + 1);
    }
    if (numberValue(summary.checksFailed) > 0) {
      counts.set('checks_failed', (counts.get('checks_failed') || 0) + numberValue(summary.checksFailed));
    }
    if (numberValue(summary.toolFailures) > 0) {
      counts.set('tool_failures', (counts.get('tool_failures') || 0) + numberValue(summary.toolFailures));
    }
    if (numberValue(summary.forbiddenFilesChanged) > 0) {
      counts.set('forbidden_files_changed', (counts.get('forbidden_files_changed') || 0) + numberValue(summary.forbiddenFilesChanged));
    }
    if (numberValue(summary.policyBlocks) > 0) {
      counts.set('policy_blocks', (counts.get('policy_blocks') || 0) + numberValue(summary.policyBlocks));
    }
    if (summary.contentCaptureDetected === true) {
      counts.set('content_capture_detected', (counts.get('content_capture_detected') || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category))
    .slice(0, 5);
}

function benchmarkRecommendation(report) {
  if (report.safetyViolationCount > 0) {
    return {
      action: 'reject',
      message: 'reject: safety violations or forbidden edits were detected.'
    };
  }
  if (report.passRate < 0.5 || report.averageScore < 60) {
    return {
      action: 'reject',
      message: 'reject: the run failed too many checks to promote.'
    };
  }
  if (report.passRate < 0.9 || report.averageScore < 80 || report.toolFailures > 0 || report.topFailureCategories.length > 0) {
    return {
      action: 'investigate',
      message: 'investigate: quality is mixed, so review failures before promoting.'
    };
  }
  return {
    action: 'keep',
    message: 'keep: the run passed cleanly with no safety regression signals.'
  };
}

function defaultBenchmarkSummaryDir() {
  return process.env.AGENTOPS_BENCHMARK_RUNS_DIR || path.join(benchmarksDir, 'runs');
}

function benchmarkSummariesFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.summaries)) return payload.summaries;
  if (Array.isArray(payload.runs)) return payload.runs;
  if (Array.isArray(payload.results)) return payload.results;
  if (payload && payload.runId) return [payload];
  return [];
}

function loadBenchmarkSummaries(runId, options = {}) {
  if (!runId) throw new Error('benchmark report requires a run id');

  const summariesDir = options.summariesDir || defaultBenchmarkSummaryDir();
  if (!fs.existsSync(summariesDir)) return [];

  const files = walk(summariesDir, file => file.endsWith('.json'));
  const preferredNames = new Set([`${runId}.json`, `${runId}.summary.json`, `run-${runId}.json`]);
  const preferredFiles = files.filter(file => preferredNames.has(path.basename(file)));
  const searchFiles = preferredFiles.length > 0 ? preferredFiles : files;
  const summaries = [];

  for (const file of searchFiles) {
    summaries.push(...benchmarkSummariesFromPayload(readJson(file)));
  }

  return summaries.filter(summary => summary.runId === runId);
}

function benchmarkReport(runId, summaries = null, options = {}) {
  if (!runId) throw new Error('benchmark report requires a run id');
  let runSummaries = (summaries || loadBenchmarkSummaries(runId)).filter(summary => summary.runId === runId);
  let azureTelemetry = null;

  if (runSummaries.length === 0) {
    if (options.azure) azureTelemetry = benchmarkAzureTelemetry(runId, options);
    const missingReport = {
      runId,
      ok: false,
      message: 'no benchmark summaries were found for this run'
    };
    if (azureTelemetry) missingReport.azureTelemetry = azureTelemetry;
    return missingReport;
  }

  if (options.azure) {
    const enriched = enrichBenchmarkSummariesWithAzure(runId, runSummaries, options);
    runSummaries = enriched.summaries;
    azureTelemetry = enriched.azureTelemetry;
  }

  const scoredSummaries = runSummaries.map(scoreBenchmarkSummary);
  const passed = scoredSummaries.filter(summary => summary.success).length;
  const inputTokens = scoredSummaries.reduce((total, summary) => total + numberValue(summary.inputTokens), 0);
  const outputTokens = scoredSummaries.reduce((total, summary) => total + numberValue(summary.outputTokens), 0);
  const report = {
    runId,
    suites: [...new Set(scoredSummaries.map(summary => summary.suite).filter(Boolean))].sort(),
    variants: [...new Set(scoredSummaries.map(summary => summary.variant).filter(Boolean))].sort(),
    hypotheses: [...new Set(scoredSummaries.map(summary => summary.hypothesis).filter(Boolean))].sort(),
    startedAt: scoredSummaries.map(summary => summary.startedAt).filter(Boolean).sort()[0] || null,
    taskCount: scoredSummaries.length,
    passed,
    failed: scoredSummaries.length - passed,
    passRate: roundNumber(passed / scoredSummaries.length, 3),
    passRatePct: roundNumber((passed / scoredSummaries.length) * 100),
    averageScore: roundNumber(scoredSummaries.reduce((total, summary) => total + summary.score, 0) / scoredSummaries.length),
    toolFailures: scoredSummaries.reduce((total, summary) => total + numberValue(summary.toolFailures), 0),
    forbiddenFilesChanged: scoredSummaries.reduce((total, summary) => total + numberValue(summary.forbiddenFilesChanged), 0),
    policyBlocks: scoredSummaries.reduce((total, summary) => total + numberValue(summary.policyBlocks), 0),
    contentCaptureDetected: scoredSummaries.some(summary => summary.contentCaptureDetected === true),
    safetyViolationCount: scoredSummaries.filter(summary => summary.safetyViolation).length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    aiu: roundNumber(scoredSummaries.reduce((total, summary) => total + numberValue(summary.aiu), 0), 3),
    cost: roundNumber(scoredSummaries.reduce((total, summary) => total + numberValue(summary.cost), 0), 4),
    topFailureCategories: topFailureCategories(scoredSummaries),
    tasks: scoredSummaries.map(summary => ({
      taskId: summary.taskId,
      hypothesis: summary.hypothesis || null,
      success: Boolean(summary.success),
      score: summary.score,
      safetyViolation: summary.safetyViolation,
      errorCategory: summary.errorCategory || null,
      telemetryMatched: Boolean(summary.telemetryMatched),
      azureSpans: numberValue(summary.azureSpans),
      models: summary.models || [],
      tools: summary.tools || [],
      penalties: summary.penalties
    }))
  };

  if (azureTelemetry) report.azureTelemetry = azureTelemetry;
  report.recommendation = benchmarkRecommendation(report);
  report.promotion = benchmarkPromotionSummary(report);
  return report;
}

function benchmarkPromotionSummary(report) {
  const action = report.recommendation?.action || 'investigate';
  const decision = action === 'keep' ? 'promote' : action;
  return {
    decision,
    evidence: {
      runId: report.runId,
      passRatePct: report.passRatePct,
      averageScore: report.averageScore,
      toolFailures: report.toolFailures,
      safetyViolationCount: report.safetyViolationCount,
      totalTokens: report.totalTokens,
      cost: report.cost
    },
    validation: report.azureTelemetry?.ok === false
      ? 'local benchmark summary only; rerun with --azure when live telemetry is required'
      : 'benchmark summary includes local checks' + (report.azureTelemetry ? ' and Azure telemetry' : ''),
    rollback: decision === 'promote'
      ? 'revert the agent, skill, hook, or MCP change if pass rate drops, safety violations appear, or token/cost increases beyond the accepted budget'
      : 'do not promote until failures, safety signals, and cost deltas are explained'
  };
}

function compareRecommendation(comparison) {
  if (comparison.safetyRegressionWarnings.length > 0) {
    return {
      action: 'reject',
      message: 'reject: the after run introduces safety regressions.'
    };
  }
  if (comparison.passRateDelta < -0.05 || comparison.averageScoreDelta < -5) {
    return {
      action: 'reject',
      message: 'reject: the after run is materially worse than the before run.'
    };
  }
  if (comparison.passRateDelta > 0 || comparison.averageScoreDelta >= 2) {
    return {
      action: 'keep',
      message: 'keep: the after run improves benchmark quality without safety regressions.'
    };
  }
  return {
    action: 'investigate',
    message: 'investigate: the before and after runs are close, so review details before deciding.'
  };
}

function compareBenchmarkRuns(beforeRunId, afterRunId, summaries = null, options = {}) {
  if (!beforeRunId || !afterRunId) throw new Error('benchmark compare requires before and after run ids');

  const allSummaries = summaries || [
    ...loadBenchmarkSummaries(beforeRunId),
    ...loadBenchmarkSummaries(afterRunId)
  ];
  const before = benchmarkReport(beforeRunId, allSummaries, options);
  const after = benchmarkReport(afterRunId, allSummaries, options);
  if (before.ok === false || after.ok === false) {
    const missingComparison = {
      ok: false,
      beforeRunId,
      afterRunId,
      message: [
        before.ok === false ? `missing before run summaries for ${beforeRunId}` : null,
        after.ok === false ? `missing after run summaries for ${afterRunId}` : null
      ].filter(Boolean).join('; ')
    };
    if (options.azure) {
      missingComparison.azureTelemetry = {
        before: before.azureTelemetry || null,
        after: after.azureTelemetry || null
      };
    }
    return missingComparison;
  }
  const safetyRegressionWarnings = [];

  if (after.safetyViolationCount > before.safetyViolationCount) {
    safetyRegressionWarnings.push('after run has more tasks with safety violations');
  }
  if (after.forbiddenFilesChanged > before.forbiddenFilesChanged) {
    safetyRegressionWarnings.push('after run changed more forbidden files');
  }
  if (after.policyBlocks > before.policyBlocks) {
    safetyRegressionWarnings.push('after run triggered more policy blocks');
  }
  if (after.contentCaptureDetected && !before.contentCaptureDetected) {
    safetyRegressionWarnings.push('after run detected content capture');
  }

  const comparison = {
    beforeRunId,
    afterRunId,
    before: {
      passRate: before.passRate,
      passRatePct: before.passRatePct,
      averageScore: before.averageScore,
      toolFailures: before.toolFailures,
      totalTokens: before.totalTokens,
      cost: before.cost
    },
    after: {
      passRate: after.passRate,
      passRatePct: after.passRatePct,
      averageScore: after.averageScore,
      toolFailures: after.toolFailures,
      totalTokens: after.totalTokens,
      cost: after.cost
    },
    passRateDelta: roundNumber(after.passRate - before.passRate, 3),
    averageScoreDelta: roundNumber(after.averageScore - before.averageScore),
    toolFailuresDelta: after.toolFailures - before.toolFailures,
    tokenDelta: after.totalTokens - before.totalTokens,
    costDelta: roundNumber(after.cost - before.cost, 4),
    safetyRegressionWarnings,
    topFailureCategories: after.topFailureCategories
  };

  if (options.azure) {
    comparison.azureTelemetry = {
      before: before.azureTelemetry || null,
      after: after.azureTelemetry || null
    };
  }

  comparison.recommendation = compareRecommendation(comparison);
  comparison.promotion = {
    decision: comparison.recommendation.action === 'keep' ? 'promote' : comparison.recommendation.action,
    evidence: {
      beforeRunId,
      afterRunId,
      passRateDelta: comparison.passRateDelta,
      averageScoreDelta: comparison.averageScoreDelta,
      toolFailuresDelta: comparison.toolFailuresDelta,
      tokenDelta: comparison.tokenDelta,
      costDelta: comparison.costDelta,
      safetyRegressionWarnings: comparison.safetyRegressionWarnings
    },
    rollback: 'revert the candidate if the benchmark or live telemetry later shows lower pass rate, new safety warnings, or unacceptable token/cost growth'
  };
  return comparison;
}

async function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }

  if (command === 'status') {
    process.stdout.write(renderStatus());
    return;
  }

  if (command === 'latest') {
    process.stdout.write(renderLatest(latestSummaryFromArgs(args)));
    return;
  }

  if (command === 'live' || command === 'tail') {
    const intervalIndex = args.indexOf('--interval');
    const intervalSec = intervalIndex === -1 ? 5 : Number(args[intervalIndex + 1]);
    if (intervalIndex !== -1 && (!Number.isFinite(intervalSec) || intervalSec <= 0)) {
      throw new Error('--interval must be a positive number of seconds');
    }
    const follow = args.includes('--follow');
    do {
      process.stdout.write(renderLive(liveViewFromArgs(args)));
      if (!follow) return;
      await sleep(intervalSec * 1000);
    } while (follow);
    return;
  }

  if (command === 'replay') {
    const sessionId = args[0];
    if (!sessionId) throw new Error('replay requires a session id or latest');
    const replayArgs = args.slice(1);
    let source;
    if (sessionId === 'latest' || optionValue(replayArgs, ['--file', '--jsonl'])) {
      source = spanRowsFromSource(replayArgs, '7d');
    } else {
      const last = validateKqlDuration(parseLastArg(replayArgs, '7d'));
      const query = sessionQuery(sessionId, last);
      const result = runAzureLogAnalyticsQuery(query);
      source = { mode: 'azure', last, rows: result.ok ? result.rows : [], query, error: result.ok ? null : result.error };
    }
    if (source.error) {
      process.stdout.write(`Session replay: ${sessionId}\n\nCould not read telemetry: ${source.error}\n`);
      return;
    }
    process.stdout.write(renderReplay(replayTimeline(source.rows, { sessionId, source: source.mode })));
    return;
  }

  if (command === 'explain') {
    if (args[0] !== 'latest') throw new Error('explain currently supports: explain latest');
    const summary = latestSummaryFromArgs(args.slice(1));
    process.stdout.write(renderExplanation(explainLatest(summary)));
    return;
  }

  if (command === 'recommend') {
    if (args[0] !== 'latest') throw new Error('recommend currently supports: recommend latest');
    const recommendArgs = args.slice(1);
    const summary = latestSummaryFromArgs(recommendArgs);
    const last = parseLastArg(recommendArgs, '7d');
    process.stdout.write(renderRecommendation(recommendationForExplanation(explainLatest(summary), { last })));
    return;
  }

  if (command === 'open') {
    const summary = latestSummaryFromArgs(args);
    process.stdout.write(renderOpenLinks(openLinksSummary(summary)));
    return;
  }

  if (command === 'scan') {
    process.stdout.write(JSON.stringify(scan(), null, 2) + '\n');
    return;
  }

  if (command === 'primitives') {
    process.stdout.write(JSON.stringify(copilotPrimitivesInventory(args), null, 2) + '\n');
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

  if (['enable-shadow', 'disable-shadow', 'uninstall'].includes(command)) {
    runPlannedCommand(commandPlan(command, args));
    return;
  }

  if (command === 'collector') {
    runPlannedCommand(commandPlan(command, args));
    return;
  }

  if (command === 'saved-view') {
    process.stdout.write(JSON.stringify(savedViewCommand(parseSavedViewArgs(args)), null, 2) + '\n');
    return;
  }

  if (command === 'benchmark') {
    const [subcommand, ...benchmarkArgs] = args;
    if (subcommand === 'list') {
      process.stdout.write(JSON.stringify(listBenchmarks(), null, 2) + '\n');
      return;
    }

    if (subcommand === 'run') {
      const options = parseBenchmarkRunArgs(benchmarkArgs);
      process.stdout.write(JSON.stringify(runBenchmarkSuite(options.suite, options), null, 2) + '\n');
      return;
    }

    if (subcommand === 'report') {
      const options = parseBenchmarkReportArgs(benchmarkArgs);
      process.stdout.write(JSON.stringify(benchmarkReport(options.runId, null, options), null, 2) + '\n');
      return;
    }

    if (subcommand === 'compare') {
      const options = parseBenchmarkCompareArgs(benchmarkArgs);
      process.stdout.write(JSON.stringify(compareBenchmarkRuns(options.beforeRunId, options.afterRunId, null, options), null, 2) + '\n');
      return;
    }

    throw new Error('benchmark requires list, run, report, or compare');
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

  if (command === 'context') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: contextPressureQuery(last) }, null, 2) + '\n');
    return;
  }

  if (command === 'token-rollup-audit') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: tokenRollupAuditQuery(last) }, null, 2) + '\n');
    return;
  }

  if (command === 'permission-friction') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: kqlFileQuery('17-permission-friction.kql', last) }, null, 2) + '\n');
    return;
  }

  if (command === 'alert') {
    const [subcommand, ...alertArgs] = args;
    if (subcommand !== 'recommend') throw new Error('alert currently supports: alert recommend');
    const last = parseLastArg(alertArgs, '14d');
    process.stdout.write(JSON.stringify(alertRecommendations(last), null, 2) + '\n');
    return;
  }

  if (command === 'lineage') {
    const last = parseLastArg(args, '24h');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: kqlFileQuery('19-agent-flow-lineage.kql', last) }, null, 2) + '\n');
    return;
  }

  if (command === 'policy') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: kqlFileQuery('15-policy-governance.kql', last) }, null, 2) + '\n');
    return;
  }

  if (command === 'mcp') {
    const last = parseLastArg(args, '7d');
    process.stdout.write(JSON.stringify({ workspace_id: workspaceId, query: kqlFileQuery('16-mcp-tool-usage.kql', last) }, null, 2) + '\n');
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
  agentopsStatusSummary,
  alertRecommendationQuery,
  alertRecommendations,
  benchmarkAzureTelemetry,
  benchmarkAzureTelemetryQuery,
  benchmarkReport,
  benchmarkRunBaseDir,
  benchmarkRunPlan,
  buildLink,
  commandPlan,
  compareBenchmarkRuns,
  contextPressureQuery,
  copilotPrimitivesInventory,
  doctor,
  explainLatest,
  fieldCatalogQuery,
  importJsonl,
  installedShimStatus,
  kqlFileQuery,
  latestAzureSessionSummary,
  latestSessionAzureQuery,
  latestSessionSummary,
  latestSummaryFromArgs,
  listBenchmarks,
  loadBenchmarkSummaries,
  loadBenchmarkSuites,
  liveViewFromArgs,
  openLinksSummary,
  parseBenchmarkCompareArgs,
  parseBenchmarkReportArgs,
  parseBenchmarkRunArgs,
  parseFrontmatter,
  parseSavedViewArgs,
  replayTimeline,
  renderExplanation,
  renderLatest,
  renderLive,
  renderOpenLinks,
  renderRecommendation,
  renderReplay,
  renderStatus,
  recommendationForExplanation,
  readJsonlRows,
  readSavedViews,
  runAzureLogAnalyticsQuery,
  runBenchmarkSuite,
  savedViewCommand,
  scan,
  sessionQuery,
  spanRowsFromSource,
  tokenRollupAuditQuery,
  enrichBenchmarkSummariesWithAzure,
  traceQuery,
  validateKqlDuration,
  validateBenchmarkTask,
  validateCollector
};
