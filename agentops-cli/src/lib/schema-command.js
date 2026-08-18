const { writeJson } = require('./command-output');
const { readJson } = require('./json');
const { exampleAgentRunAttributes, schemaDocument, validateAgentRun } = require('./schema/agent-run-schema');

function readInputFile(args) {
  const index = args.indexOf('--file');
  if (index === -1) return null;
  if (!args[index + 1]) throw new Error('--file requires a path');
  return readJson(args[index + 1]);
}

function schemaCommand(args = []) {
  const [subcommand = 'validate'] = args;
  if (subcommand === 'print') {
    writeJson(schemaDocument());
    return;
  }
  if (subcommand !== 'validate') throw new Error('schema supports: validate|print');

  const input = readInputFile(args) || { attributes: exampleAgentRunAttributes() };
  const result = validateAgentRun(input);
  writeJson(result);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  schemaCommand
};
