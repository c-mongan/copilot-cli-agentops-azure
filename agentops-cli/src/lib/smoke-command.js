const { writeJsonOrRender } = require('./command-output');

function writeSmokeResult(result, options, renderSmoke, stdout, setExitCode) {
  writeJsonOrRender(result, options.json, renderSmoke, stdout);
  setExitCode(result.ok ? 0 : 1);
}

const smokeCommandNames = Object.freeze(['smoke', 'attribution-smoke', 'live-replay-smoke']);

function createSmokeCommand(dependencies = {}) {
  const {
    agentopsAttributionSmoke,
    agentopsLiveReplaySmoke,
    agentopsSmoke,
    parseSmokeArgs,
    renderSmoke,
    setExitCode = code => {
      process.exitCode = code;
    },
    stdout = process.stdout
  } = dependencies;

  async function smokeCommand(command, args) {
    const options = parseSmokeArgs(args);
    if (command === 'smoke') {
      writeSmokeResult(await agentopsSmoke(options), options, renderSmoke, stdout, setExitCode);
      return;
    }
    if (command === 'attribution-smoke') {
      writeSmokeResult(await agentopsAttributionSmoke(options), options, renderSmoke, stdout, setExitCode);
      return;
    }
    if (command === 'live-replay-smoke') {
      writeSmokeResult(await agentopsLiveReplaySmoke(options), options, renderSmoke, stdout, setExitCode);
      return;
    }
    throw new Error(`Unknown smoke command: ${command}`);
  }

  return {
    smokeCommand,
    smokeCommandNames
  };
}

module.exports = {
  createSmokeCommand
};
