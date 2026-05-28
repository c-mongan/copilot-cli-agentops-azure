const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const cliRoot = path.join(repoRoot, 'agentops-cli');
const srcRoot = path.join(cliRoot, 'src');
const collectorDir = path.join(repoRoot, 'collector');
const scriptsDir = path.join(repoRoot, 'scripts');
const copilotDir = path.join(repoRoot, 'copilot');
const defaultInstallDir = path.join(os.homedir(), '.local', 'bin');
const agentopsHome = process.env.AGENTOPS_HOME || path.join(os.homedir(), '.agentops');
const collectorHome = process.env.AGENTOPS_COLLECTOR_HOME || path.join(agentopsHome, 'collector');

function repoPath(...parts) {
  return path.join(repoRoot, ...parts);
}

function collectorConfigPath({ target = 'azuremonitor', privacy = 'strict' } = {}) {
  return path.join(collectorDir, `otelcol.${target}.${privacy}.yaml`);
}

module.exports = {
  agentopsHome,
  cliRoot,
  collectorConfigPath,
  collectorDir,
  collectorHome,
  copilotDir,
  defaultInstallDir,
  repoPath,
  repoRoot,
  scriptsDir,
  srcRoot
};
