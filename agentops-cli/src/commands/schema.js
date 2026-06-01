const fs = require('node:fs');
const { schemaDocument, validateAgentRun } = require('../lib/schema/agent-run-schema');

function readInputFile(args) {
  const index = args.indexOf('--file');
  if (index === -1) return null;
  if (!args[index + 1]) throw new Error('--file requires a path');
  return JSON.parse(fs.readFileSync(args[index + 1], 'utf8'));
}

function schemaCommand(args = []) {
  const [subcommand = 'validate'] = args;
  if (subcommand === 'print') {
    process.stdout.write(`${JSON.stringify(schemaDocument(), null, 2)}\n`);
    return;
  }
  if (subcommand !== 'validate') throw new Error('schema supports: validate|print');

  const input = readInputFile(args) || { attributes: require('../lib/schema/agent-run-schema').exampleAgentRunAttributes() };
  const result = validateAgentRun(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  schemaCommand
};
