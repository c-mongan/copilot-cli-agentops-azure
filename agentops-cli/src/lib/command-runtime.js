const childProcess = require('node:child_process');
const { commandPlan: commandPlanBase } = require('./command-plan');
const { buildLink: buildLinkBase } = require('./observability-queries');

function createCommandRuntime(dependencies = {}) {
  const {
    commandCandidates = () => [],
    configuredCloudValues,
    grafanaBaseUrl,
    portalLogsUrl,
    root,
    workspaceId
  } = dependencies;

  function buildLink(kind, id, options = {}) {
    return buildLinkBase(kind, id, {
      grafanaBaseUrl,
      portalLogsUrl,
      workspaceId,
      ...options
    });
  }

  function commandPlan(command, args = [], platform = process.platform) {
    return commandPlanBase(command, args, platform, { root, configuredCloudValues });
  }

  function runPlannedCommand(plan) {
    let executable = plan.command;
    if (executable === 'pwsh' && process.platform === 'win32' && commandCandidates('pwsh').length === 0) {
      executable = 'powershell.exe';
    }

    const result = childProcess.spawnSync(executable, plan.args, {
      stdio: 'inherit',
      env: { ...process.env, ...(plan.env || {}) }
    });
    if (result.error) throw result.error;
    process.exitCode = result.status === null ? 1 : result.status;
  }

  return {
    buildLink,
    commandPlan,
    runPlannedCommand
  };
}

module.exports = {
  createCommandRuntime
};
