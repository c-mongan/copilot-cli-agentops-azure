const fs = require('node:fs');
const path = require('node:path');
const { hashText } = require('./hash');
const { parseFrontmatter } = require('./plugin-assets');
const { readJson } = require('./json');

function createLocalStatus(options = {}) {
  const root = options.root;
  const defaultInstallDir = options.defaultInstallDir;

  function walk(dir, predicate, results = []) {
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath, predicate, results);
      if (entry.isFile() && predicate(fullPath)) results.push(fullPath);
    }
    return results;
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

  function shadowObservesCopilot(shadowPath) {
    if (!fs.existsSync(shadowPath)) return false;
    try {
      const resolved = fs.realpathSync.native(shadowPath);
      const marker = /(?:copilot-agentops|copilot-observe|agentops-cli[\\/].*copilot)/i;
      if (marker.test(resolved)) return true;
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size > 1024 * 1024) return false;
      return marker.test(fs.readFileSync(resolved, 'utf8'));
    } catch {
      return false;
    }
  }

  function installedShimStatus(installDir = defaultInstallDir) {
    const shadowName = process.platform === 'win32' ? 'copilot.cmd' : 'copilot';
    const agentopsName = process.platform === 'win32' ? 'copilot-agentops.cmd' : 'copilot-agentops';
    const agentopsCliName = process.platform === 'win32' ? 'agentops.cmd' : 'agentops';
    const shadowPath = path.join(installDir, shadowName);
    const agentopsPath = path.join(installDir, agentopsName);
    const agentopsCliPath = path.join(installDir, agentopsCliName);
    const copilotCommands = commandCandidates('copilot');
    const installDirFull = path.resolve(installDir);
    const firstCopilot = copilotCommands[0] || null;
    const shadowInstalled = fs.existsSync(shadowPath);
    const shadowFirst = firstCopilot ? path.resolve(firstCopilot).startsWith(installDirFull) : false;
    const shadowValid = shadowObservesCopilot(shadowPath);
    const realCopilot = copilotCommands.find(candidate => !path.resolve(candidate).startsWith(installDirFull)) || null;

    return {
      install_dir: installDir,
      agentops_cli_installed: fs.existsSync(agentopsCliPath),
      agentops_cli_path: agentopsCliPath,
      copilot_agentops_installed: fs.existsSync(agentopsPath),
      copilot_agentops_path: agentopsPath,
      shadow_installed: shadowInstalled,
      shadow_valid: shadowValid,
      shadow_path: shadowPath,
      plain_copilot_observed: shadowInstalled && shadowValid && shadowFirst,
      first_copilot_on_path: firstCopilot,
      real_copilot: realCopilot,
      copilot_candidates: copilotCommands
    };
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
    const agentopsCli = checkByName(checks, 'agentops-command');
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
        agentops_cli: agentopsCli?.status || 'unknown',
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

    const agentopsCli = summary.shim.agentops_cli === 'installed' ? 'installed' : 'not installed';
    const agentopsCommand = summary.shim.agentops_command === 'installed' ? 'installed' : 'not installed';
    const shadow = summary.shim.shadow === 'observed'
      ? 'plain copilot is routed through AgentOps'
      : summary.shim.shadow === 'installed_not_first_on_path'
        ? 'installed, but not first on PATH'
        : summary.shim.shadow === 'not_installed'
          ? 'plain copilot shadow is not installed'
        : summary.shim.shadow.replace(/_/g, ' ');
    lines.push(`Shim: agentops is ${agentopsCli}; copilot-agentops is ${agentopsCommand}; ${shadow}.`);

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
    const hooks = fs.existsSync(hookPath) ? readJson(hookPath) : null;

    const mcpPath = path.join(root, 'plugin', '.mcp.json');
    const mcp = fs.existsSync(mcpPath) ? readJson(mcpPath) : null;

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
      'collector/otelcol.local.strict.yaml',
      'collector/docker-compose.yaml',
      'plugin/plugin.json',
      'plugin/hooks.json',
      'scripts/copilot-agentops',
      'scripts/copilot-agentops.ps1',
      'scripts/install-copilot-agentops-shim.sh',
      'scripts/install-copilot-agentops-shim.ps1',
      'scripts/uninstall-copilot-agentops-shim.sh',
      'scripts/uninstall-copilot-agentops-shim.ps1',
      'azure.yaml'
    ];

    for (const file of requiredFiles) {
      checks.push({ name: `exists:${file}`, ok: fs.existsSync(path.join(root, file)) });
    }

    const contentCapture = process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT === 'true';
    checks.push({ name: 'content-capture-disabled', ok: !contentCapture });

    const localConfig = fs.readFileSync(path.join(root, 'collector', 'otelcol.local.yaml'), 'utf8');
    const strictLocalConfig = fs.readFileSync(path.join(root, 'collector', 'otelcol.local.strict.yaml'), 'utf8');
    checks.push({ name: 'collector-http-localhost', ok: localConfig.includes('endpoint: 127.0.0.1:4318') });
    checks.push({ name: 'collector-grpc-localhost', ok: localConfig.includes('endpoint: 127.0.0.1:4317') });
    checks.push({ name: 'collector-strict-http-localhost', ok: strictLocalConfig.includes('endpoint: 127.0.0.1:4318') });
    checks.push({ name: 'collector-strict-grpc-localhost', ok: strictLocalConfig.includes('endpoint: 127.0.0.1:4317') });
    checks.push({ name: 'collector-strict-receipt-localhost', ok: strictLocalConfig.includes('endpoint: 127.0.0.1:4319') });

    const scanResult = scan();
    checks.push({ name: 'agents-present', ok: scanResult.agents.length >= 1 });
    checks.push({ name: 'skills-present', ok: scanResult.skills.length >= 1 });

    const shim = installedShimStatus();
    checks.push({
      name: 'agentops-command',
      ok: true,
      status: shim.agentops_cli_installed ? 'installed' : 'not_installed',
      path: shim.agentops_cli_path
    });
    checks.push({
      name: 'copilot-agentops-command',
      ok: true,
      status: shim.copilot_agentops_installed ? 'installed' : 'not_installed',
      path: shim.copilot_agentops_path
    });
    checks.push({
      name: 'plain-copilot-shadow',
      ok: true,
      status: shim.plain_copilot_observed
        ? 'observed'
        : (shim.shadow_installed
            ? (shim.shadow_valid ? 'installed_not_first_on_path' : 'installed_invalid')
            : 'not_installed'),
      first_copilot_on_path: shim.first_copilot_on_path,
      real_copilot: shim.real_copilot,
      shadow_path: shim.shadow_path
    });

    if (!localOnly) {
      checks.push({ name: 'azure-validation', ok: false, note: 'Run azure-validate before deployment.' });
    }

    return checks;
  }

  return {
    agentopsStatusSummary,
    commandCandidates,
    doctor,
    installedShimStatus,
    renderStatus,
    scan,
    shadowObservesCopilot
  };
}

module.exports = {
  createLocalStatus
};
