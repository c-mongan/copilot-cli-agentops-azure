const { writeJsonOrRender } = require('./command-output');
const { renderStatus, statusSummary } = require('./status-summary');

async function statusCommand(args = []) {
  const json = args.includes('--json');
  const summary = await statusSummary();
  writeJsonOrRender(summary, json, renderStatus);
  process.exitCode = summary.ok ? 0 : 1;
}

module.exports = {
  renderStatus,
  statusCommand,
  statusSummary
};
