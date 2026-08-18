const plannedCommandNames = Object.freeze([
  'install',
  'enable-shadow',
  'disable-shadow',
  'uninstall',
  'collector',
  'start',
  'stop',
  'copilot',
  'codex'
]);

function createPlannedCommand(dependencies = {}) {
  const {
    commandPlan,
    runPlannedCommand
  } = dependencies;

  function plannedCommand(command, args) {
    runPlannedCommand(commandPlan(command, args));
  }

  return {
    plannedCommand,
    plannedCommandNames
  };
}

module.exports = {
  createPlannedCommand
};
