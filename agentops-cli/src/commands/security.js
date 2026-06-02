const { securityAudit } = require('../lib/security-audit');

function renderSecurityAudit(audit) {
  const lines = ['AgentOps security audit'];
  for (const check of audit.checks) {
    const status = check.severity === 'warning' ? 'warn' : check.ok ? 'ok' : 'failed';
    lines.push(`- ${check.name}: ${status}${check.detail ? ` (${check.detail})` : ''}`);
  }
  lines.push('', audit.ok ? 'Security audit passed with no blocking issues.' : 'Security audit found blocking issues.');
  if (audit.next) lines.push(audit.next);
  return `${lines.join('\n')}\n`;
}

async function securityCommand(args = []) {
  const [subcommand = 'audit'] = args;
  if (subcommand !== 'audit') throw new Error('security supports: audit');
  const json = args.includes('--json');
  const failOnWarning = args.includes('--fail-on-warning');
  const audit = securityAudit();
  process.stdout.write(json ? `${JSON.stringify(audit, null, 2)}\n` : renderSecurityAudit(audit));
  process.exitCode = audit.ok && (!failOnWarning || audit.summary.warnings === 0) ? 0 : 1;
}

module.exports = {
  renderSecurityAudit,
  securityCommand
};
