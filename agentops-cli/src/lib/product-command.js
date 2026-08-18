const path = require('node:path');

const { hasFlag, optionValue } = require('./args');
const { browserProfileOptionsFromArgs } = require('./browser-options');
const { writeJsonOrRender } = require('./command-output');
const { e2eBrowserCheck } = require('./e2e-browser-check');
const { repoRoot } = require('./paths');
const { productAudit } = require('./product-audit');
const { renderProductAudit } = require('./product-audit-render');
const { productAuditWithVisual: runProductAuditWithVisual } = require('./product-audit-visual');
const { validateVisualEvidence, visualAuditRecoveryCommands } = require('./product-visual');

async function productAuditWithVisual(options = {}) {
  return runProductAuditWithVisual(options, {
    productAudit,
    browserCheck: options.browserCheck || e2eBrowserCheck
  });
}

async function productCommand(args = []) {
  const [subcommand = 'audit'] = args;
  if (subcommand !== 'audit') throw new Error('product supports: audit');
  const result = await productAuditWithVisual({
    live: hasFlag(args, '--live'),
    requireRows: hasFlag(args, '--require-rows'),
    requireVisual: hasFlag(args, '--require-visual'),
    last: optionValue(args, '--last', '24h'),
    reportPath: optionValue(args, '--report', path.join(repoRoot, '.agentops', 'e2e', 'latest', 'report.html')),
    ...browserProfileOptionsFromArgs(args),
    visualEvidencePath: optionValue(args, '--visual-evidence', '')
  });
  writeJsonOrRender(result, hasFlag(args, '--json'), renderProductAudit);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  productAudit,
  productAuditWithVisual,
  productCommand,
  renderProductAudit,
  validateVisualEvidence,
  visualAuditRecoveryCommands
};
