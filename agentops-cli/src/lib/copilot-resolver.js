const fs = require('node:fs');
const path = require('node:path');

const { copilotDir, defaultInstallDir, repoRoot, scriptsDir } = require('./paths');
const { commandCandidates, isExecutable } = require('./shell');

function realPathMaybe(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function fileLooksLikeAgentOpsShim(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) return false;
    const text = fs.readFileSync(filePath, 'utf8');
    return /copilot-agentops|copilot-observe|AgentOps|AGENTOPS_/i.test(text);
  } catch {
    return false;
  }
}

function agentopsShimPaths(env = process.env) {
  const installDir = env.AGENTOPS_BIN_DIR || defaultInstallDir;
  return [
    path.join(scriptsDir, 'copilot-agentops'),
    path.join(scriptsDir, 'copilot-agentops.ps1'),
    path.join(copilotDir, 'copilot-observe'),
    path.join(copilotDir, 'copilot-observe.ps1'),
    path.join(installDir, 'copilot'),
    path.join(installDir, 'copilot.cmd'),
    path.join(installDir, 'copilot-agentops'),
    path.join(installDir, 'copilot-agentops.cmd')
  ].map(realPathMaybe);
}

function isAgentOpsShim(filePath, env = process.env) {
  if (!filePath) return false;
  const resolved = realPathMaybe(filePath);
  const shimSet = new Set(agentopsShimPaths(env));
  if (shimSet.has(resolved)) return true;
  const repoPrefix = realPathMaybe(repoRoot) + path.sep;
  if (resolved.startsWith(repoPrefix) && /\/(scripts\/copilot-agentops|copilot\/copilot-observe)(\.ps1)?$/.test(resolved)) return true;
  return fileLooksLikeAgentOpsShim(resolved);
}

function validateCandidate(filePath, env = process.env) {
  const resolved = filePath ? realPathMaybe(filePath) : null;
  if (!resolved) return { ok: false, path: null, error: 'No Copilot CLI path was provided.' };
  if (!fs.existsSync(resolved)) return { ok: false, path: resolved, error: `Copilot CLI path does not exist: ${resolved}` };
  if (!isExecutable(resolved)) return { ok: false, path: resolved, error: `Copilot CLI path is not executable: ${resolved}` };
  if (isAgentOpsShim(resolved, env)) {
    return { ok: false, path: resolved, error: `Resolved Copilot path points to an AgentOps shim: ${resolved}` };
  }
  return { ok: true, path: resolved, error: null };
}

function resolveCopilotBinary(options = {}) {
  const env = options.env || process.env;
  if (env.COPILOT_CLI_BIN) {
    return {
      source: 'COPILOT_CLI_BIN',
      candidates: [env.COPILOT_CLI_BIN],
      ...validateCandidate(env.COPILOT_CLI_BIN, env)
    };
  }

  const candidates = commandCandidates('copilot', {
    platform: options.platform || process.platform,
    pathValue: options.pathValue || env.PATH || ''
  });

  for (const candidate of candidates) {
    const validation = validateCandidate(candidate, env);
    if (validation.ok) {
      return {
        source: 'PATH',
        candidates,
        ...validation
      };
    }
  }

  const rejected = candidates.map(candidate => validateCandidate(candidate, env));
  return {
    ok: false,
    path: null,
    source: 'PATH',
    candidates,
    rejected,
    error: candidates.length
      ? 'Only AgentOps shim candidates were found for copilot; set COPILOT_CLI_BIN to the real GitHub Copilot CLI.'
      : 'GitHub Copilot CLI was not found on PATH. Install Copilot CLI or set COPILOT_CLI_BIN.'
  };
}

module.exports = {
  agentopsShimPaths,
  isAgentOpsShim,
  resolveCopilotBinary,
  validateCandidate
};
