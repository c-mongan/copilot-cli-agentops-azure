const { jsonOutput } = require('./command-output');

const coreCommandNames = Object.freeze(['setup', 'status', 'configure', 'config', 'otel-setup', 'init', 'ask-context']);

function createCoreCommand(dependencies = {}) {
  const {
    agentopsConfigure,
    agentopsInit,
    agentopsSetupGuide,
    askAgentOpsContext,
    buildOtelSetup,
    parseAskContextArgs,
    parseConfigureArgs,
    parseInitArgs,
    parseOtelSetupArgs,
    parseSetupArgs,
    renderAskContext,
    renderConfigure,
    renderInit,
    renderOtelSetup,
    renderSetupGuide,
    renderStatus,
    setExitCode = code => {
      process.exitCode = code;
    },
    stdout = process.stdout
  } = dependencies;

  function coreCommand(command, args) {
    if (command === 'setup') {
      const options = parseSetupArgs(args);
      const result = agentopsSetupGuide(options);
      stdout.write(options.json ? jsonOutput(result) : renderSetupGuide(result));
      setExitCode(0);
      return;
    }
    if (command === 'status') {
      stdout.write(renderStatus());
      return;
    }
    if (command === 'configure' || command === 'config') {
      const options = parseConfigureArgs(args);
      const result = agentopsConfigure(options);
      stdout.write(options.json ? jsonOutput(result) : renderConfigure(result));
      setExitCode(result.ok === false ? 1 : 0);
      return;
    }
    if (command === 'otel-setup') {
      const options = parseOtelSetupArgs(args);
      stdout.write(renderOtelSetup(buildOtelSetup(options), options));
      return;
    }
    if (command === 'init') {
      const options = parseInitArgs(args);
      const result = agentopsInit(options);
      stdout.write(options.json ? jsonOutput(result) : renderInit(result));
      setExitCode(0);
      return;
    }
    if (command === 'ask-context') {
      const options = parseAskContextArgs(args);
      const result = askAgentOpsContext(options);
      stdout.write(options.json ? jsonOutput(result) : renderAskContext(result));
      setExitCode(result.ok ? 0 : 1);
      return;
    }
    throw new Error(`Unknown core command: ${command}`);
  }

  return {
    coreCommand,
    coreCommandNames
  };
}

module.exports = {
  createCoreCommand
};
