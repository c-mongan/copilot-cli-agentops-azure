const { hasFlag } = require('./args');
const { validateDashboardContentGuardrails } = require('./dashboard-content-guardrails');
const { dashboardKqlCheck } = require('./dashboard-kql-check');
const {
  validateDashboardFilters,
  validateDashboardLinks,
  validateDashboardUx,
  validateDashboards
} = require('./dashboard-validation');

function dashboardVerify(args = [], options = {}) {
  const includeLive = hasFlag(args, '--live') || hasFlag(args, '--kql');
  const checks = {
    validate: validateDashboards(),
    links: validateDashboardLinks(),
    filters: validateDashboardFilters(),
    ux: validateDashboardUx(),
    content: validateDashboardContentGuardrails()
  };
  if (includeLive) checks.kql = dashboardKqlCheck(args.map(arg => arg === '--kql' ? '--live' : arg), options);

  const errors = Object.entries(checks)
    .flatMap(([name, result]) => (result.errors || []).map(error => `${name}: ${error}`));
  return {
    ok: errors.length === 0,
    live: includeLive,
    checks,
    summary: {
      dashboards: checks.validate.dashboards,
      v2_dashboards: checks.links.dashboards,
      checked_links: checks.links.checked_links,
      filter_dashboards: checks.filters.dashboards,
      ux_contracts: checks.ux.contracts,
      kql_checks: checks.kql?.checks?.length || 0
    },
    errors,
    next: errors.length === 0
      ? [
        includeLive ? 'agentops open' : 'agentops dashboard verify --live --last 24h',
        'agentops validate-azure --last 24h'
      ]
      : [
        'agentops dashboard validate',
        'agentops dashboard links-check',
        'agentops dashboard filters-check',
        'agentops dashboard ux-check',
        'agentops dashboard kql-check --last 24h'
      ]
  };
}

module.exports = {
  dashboardVerify
};
