const path = require('node:path');
const { writeJsonOrRender } = require('./command-output');

function writeResult(result, options, renderCustom, stdout, setExitCode) {
  writeJsonOrRender(result, options.json, renderCustom, stdout);
  setExitCode(result.ok ? 0 : 1);
}

const customTelemetryCommandNames = Object.freeze(['custom', 'annotation', 'annotate']);

function createCustomTelemetryCommand(dependencies = {}) {
  const {
    agentopsAnnotationConfigChange,
    agentopsCustomEmit,
    agentopsCustomImport,
    parseAnnotationArgs,
    parseCustomArgs,
    renderCustom,
    setExitCode = code => {
      process.exitCode = code;
    },
    stdout = process.stdout
  } = dependencies;

  async function customCommand(args) {
    const options = parseCustomArgs(args);
    if (options.subcommand === 'emit') {
      writeResult(await agentopsCustomEmit(options), options, renderCustom, stdout, setExitCode);
      return;
    }
    if (options.subcommand === 'import') {
      if (!options.file) throw new Error('custom import requires a file path');
      writeResult(await agentopsCustomImport(path.resolve(options.file), options), options, renderCustom, stdout, setExitCode);
      return;
    }
    throw new Error('custom requires emit or import');
  }

  async function annotationCommand(args) {
    const options = parseAnnotationArgs(args);
    if (options.subcommand === 'config-change') {
      writeResult(await agentopsAnnotationConfigChange(options), options, renderCustom, stdout, setExitCode);
      return;
    }
    throw new Error('annotation requires config-change');
  }

  async function customTelemetryCommand(command, args) {
    if (command === 'custom') {
      await customCommand(args);
      return;
    }
    if (command === 'annotation' || command === 'annotate') {
      await annotationCommand(args);
      return;
    }
    throw new Error(`Unknown custom telemetry command: ${command}`);
  }

  return {
    customTelemetryCommand,
    customTelemetryCommandNames
  };
}

module.exports = {
  createCustomTelemetryCommand
};
