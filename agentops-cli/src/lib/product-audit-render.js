function renderProductAudit(result) {
  const lines = [
    'AgentOps product audit',
    '',
    `Result: ${result.ok ? 'pass' : 'needs work'}.`,
    `Local checks: ${result.summary.passed}/${result.summary.checks} passed.`,
    `Dashboards: ${result.summary.v2_dashboards}; links checked: ${result.summary.checked_links}.`,
    `Live Azure verified: ${result.live_azure_verified ? 'yes' : 'not in this audit'}.`,
    `Live Grafana verified: ${result.live_grafana_verified ? 'yes' : 'not in this audit'}.`,
    `Visual Grafana verified: ${result.visual_grafana_verified ? 'yes' : result.summary.visual_dashboards ? 'no' : 'not in this audit'}.`,
    '',
    'Checks:'
  ];
  for (const item of result.checks) {
    lines.push(`- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
    if (!item.ok && item.missing.length) {
      lines.push(`  Missing: ${item.missing.slice(0, 5).join(', ')}${item.missing.length > 5 ? ', ...' : ''}`);
    }
  }
  lines.push('', 'Next:');
  for (const command of result.next) lines.push(`- ${command}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderProductAudit
};
