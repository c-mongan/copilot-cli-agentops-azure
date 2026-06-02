const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

function readPackageName(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')).name;
  } catch {
    return null;
  }
}

function resolveRoots() {
  const cliPackageRoot = path.resolve(__dirname, '..', '..');
  const cliPackageName = readPackageName(path.join(cliPackageRoot, 'package.json'));
  if (cliPackageName === 'copilot-agentops-cli') {
    const sourceRepoRoot = path.dirname(cliPackageRoot);
    if (path.basename(cliPackageRoot) === 'agentops-cli' && fs.existsSync(path.join(sourceRepoRoot, 'collector'))) {
      return { repoRoot: sourceRepoRoot, cliRoot: cliPackageRoot, packageRoot: cliPackageRoot };
    }
    return { repoRoot: cliPackageRoot, cliRoot: cliPackageRoot, packageRoot: cliPackageRoot };
  }

  const sourceRepoRoot = path.resolve(__dirname, '..', '..', '..');
  return { repoRoot: sourceRepoRoot, cliRoot: path.join(sourceRepoRoot, 'agentops-cli'), packageRoot: path.join(sourceRepoRoot, 'agentops-cli') };
}

const roots = resolveRoots();
const repoRoot = roots.repoRoot;
const cliRoot = roots.cliRoot;
const packageRoot = roots.packageRoot;
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
  packageRoot,
  repoPath,
  repoRoot,
  scriptsDir,
  srcRoot
};
