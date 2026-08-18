const path = require('node:path');

const { hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const { buildContentStatus, captureModeSummary, renderContentStatus, renderOptInGuide } = require('./content-status');
const { repoRoot } = require('./paths');

function contentCommand(args = []) {
  const [subcommand = 'status'] = args;
  if (!['status', 'opt-in'].includes(subcommand)) throw new Error('content supports: status|opt-in');

  if (subcommand === 'opt-in') {
    const guide = { ok: true, default_capture: 'off', mode: 'explicit_opt_in', checklist: renderOptInGuide().trim().split(/\n/) };
    writeJsonOrRender(guide, hasFlag(args, '--json'), renderOptInGuide);
    return;
  }

  const status = buildContentStatus({
    dir: optionValue(args, '--dir', path.join(repoRoot, '.agentops', 'demo', 'latest')),
    runsFile: optionValue(args, '--runs', ''),
    allowContent: hasFlag(args, '--allow-content')
  });
  writeJsonOrRender(status, hasFlag(args, '--json'), renderContentStatus);
  if (!status.ok) process.exitCode = 1;
}

module.exports = {
  buildContentStatus,
  captureModeSummary,
  contentCommand,
  renderContentStatus,
  renderOptInGuide
};
