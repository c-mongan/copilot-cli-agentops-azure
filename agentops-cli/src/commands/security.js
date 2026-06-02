const { securityAudit, securityPosture } = require('../lib/security-audit');

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

function renderSecurityPosture(posture) {
  const lines = ['AgentOps security posture'];
  for (const control of posture.controls) {
    lines.push(`- ${control.id} ${control.risk}: ${control.status} (${control.summary})`);
  }
  lines.push('', posture.ok ? 'Security posture has no evidence gaps.' : 'Security posture has evidence gaps.');
  if (posture.next) lines.push(posture.next);
  return `${lines.join('\n')}\n`;
}

async function securityCommand(args = []) {
  const [subcommand = 'audit'] = args;
  const json = args.includes('--json');
  const failOnWarning = args.includes('--fail-on-warning');
  if (subcommand === 'posture') {
    const posture = securityPosture();
    process.stdout.write(json ? `${JSON.stringify(posture, null, 2)}\n` : renderSecurityPosture(posture));
    process.exitCode = posture.ok ? 0 : 1;
    return;
  }
  if (subcommand !== 'audit') throw new Error('security supports: audit, posture');
  const audit = securityAudit();
  process.stdout.write(json ? `${JSON.stringify(audit, null, 2)}\n` : renderSecurityAudit(audit));
  process.exitCode = audit.ok && (!failOnWarning || audit.summary.warnings === 0) ? 0 : 1;
}

module.exports = {
  renderSecurityAudit,
  renderSecurityPosture,
  securityCommand
};
