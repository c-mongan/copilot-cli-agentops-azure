const { writeJson, writeJsonOrRender } = require('./command-output');
const { optionValue } = require('./args');

function writeValidationResult(result, json, render, stdout, setExitCode) {
  writeJsonOrRender(result, json, render, stdout);
  setExitCode(result.ok ? 0 : 1);
}

const validationCommandNames = Object.freeze(['validate-collector', 'validate-azure', 'validate-enterprise']);

function createValidationCommand(dependencies = {}) {
  const {
    parseLastArg,
    renderValidateAzure,
    renderValidateEnterprise,
    setExitCode = code => {
      process.exitCode = code;
    },
    stdout = process.stdout,
    validateAzure,
    validateCollector,
    validateEnterprise
  } = dependencies;

  async function validationCommand(command, args) {
    if (command === 'validate-collector') {
      writeJson(await validateCollector(args[0]), stdout);
      return;
    }

    if (command === 'validate-azure') {
      const result = validateAzure({
        last: parseLastArg(args, '2h'),
        importDashboards: args.includes('--import-dashboards'),
        verifyDashboardContent: args.includes('--verify-dashboard-content'),
        production: args.includes('--production'),
        readinessProfile: optionValue(args, '--profile', ''),
        remediationPlan: args.includes('--remediation-plan')
      });
      writeValidationResult(result, args.includes('--json'), renderValidateAzure, stdout, setExitCode);
      return;
    }

    if (command === 'validate-enterprise') {
      const result = validateEnterprise();
      writeValidationResult(result, args.includes('--json'), renderValidateEnterprise, stdout, setExitCode);
      return;
    }

    throw new Error(`Unknown validation command: ${command}`);
  }

  return {
    validationCommand,
    validationCommandNames
  };
}

module.exports = {
  createValidationCommand
};
