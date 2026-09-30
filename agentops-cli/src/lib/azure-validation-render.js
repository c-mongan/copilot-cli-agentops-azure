function renderValidateAzure(result) {
  const lines = ['AgentOps Azure validation', ''];
  for (const check of result.checks) {
    const status = check.skipped ? 'skipped' : check.ok ? 'ok' : 'failed';
    lines.push(`- ${check.name}: ${status}${check.detail ? ` (${check.detail})` : ''}`);
    if (check.name === 'grafana-dashboards' && !check.ok && Array.isArray(check.missing) && check.missing.length > 0) {
      lines.push(`  missing: ${check.missing.join(', ')}`);
      lines.push('  fix: agentops validate-azure --import-dashboards --last 24h');
    }
  }
  lines.push('', result.ok ? 'Azure validation passed.' : 'Azure validation is incomplete.');
  if (result.remediation_plan) {
    lines.push('', 'Remediation plan:', result.remediation_plan.note);
    for (const action of result.remediation_plan.actions || []) {
      lines.push(`- ${action.name} (${action.risk}): ${action.reason}`);
      lines.push(`  review: ${action.review}`);
      for (const command of action.commands || []) lines.push(`  command: ${command}`);
    }
  }
  lines.push('Next:');
  for (const item of result.next) lines.push(`- ${item}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderValidateAzure
};
