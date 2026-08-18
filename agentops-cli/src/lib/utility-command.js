const path = require('node:path');
const { writeJson } = require('./command-output');

const utilityCommandNames = Object.freeze(['scan', 'primitives', 'doctor', 'import-jsonl', 'saved-view']);

function createUtilityCommand(dependencies = {}) {
  const {
    copilotPrimitivesInventory,
    doctor,
    importJsonl,
    parseSavedViewArgs,
    savedViewCommand,
    scan,
    setExitCode = code => {
      process.exitCode = code;
    },
    stdout = process.stdout
  } = dependencies;

  function utilityCommand(command, args) {
    if (command === 'scan') {
      writeJson(scan(), stdout);
      return;
    }
    if (command === 'primitives') {
      writeJson(copilotPrimitivesInventory(args), stdout);
      return;
    }
    if (command === 'doctor') {
      const checks = doctor({ localOnly: args.includes('--local-only') });
      const ok = checks.every(check => check.ok);
      writeJson({ checks, ok }, stdout);
      setExitCode(ok ? 0 : 1);
      return;
    }
    if (command === 'import-jsonl') {
      const filePath = args[0];
      if (!filePath) throw new Error('import-jsonl requires a file path');
      writeJson(importJsonl(path.resolve(filePath)), stdout);
      return;
    }
    if (command === 'saved-view') {
      writeJson(savedViewCommand(parseSavedViewArgs(args)), stdout);
      return;
    }
    throw new Error(`Unknown utility command: ${command}`);
  }

  return {
    utilityCommand,
    utilityCommandNames
  };
}

module.exports = {
  createUtilityCommand
};
