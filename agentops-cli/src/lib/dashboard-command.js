const { writeJson } = require('./command-output');
const { validateDashboardContentGuardrails } = require('./dashboard-content-guardrails');
const { dashboardImportPlan, runDashboardImport } = require('./dashboard-import');
const { dashboardKqlCheck, substituteGrafanaMacros } = require('./dashboard-kql-check');
const { dashboardVerify } = require('./dashboard-verify');
const {
  validateDashboardFilters,
  validateDashboardLinks,
  validateDashboardUx,
  validateDashboards
} = require('./dashboard-validation');

function dashboardCommand(args = []) {
  const [subcommand = 'validate'] = args;
  if (!['validate', 'links-check', 'filters-check', 'ux-check', 'content-check', 'kql-check', 'verify', 'import'].includes(subcommand)) throw new Error('dashboard supports: validate|links-check|filters-check|ux-check|content-check|kql-check|verify|import');
  const result = subcommand === 'links-check'
    ? validateDashboardLinks()
    : subcommand === 'filters-check'
      ? validateDashboardFilters()
    : subcommand === 'content-check'
      ? validateDashboardContentGuardrails()
    : subcommand === 'ux-check'
      ? validateDashboardUx()
    : subcommand === 'verify'
      ? dashboardVerify(args.slice(1))
    : subcommand === 'kql-check'
      ? dashboardKqlCheck(args.slice(1))
    : subcommand === 'import'
      ? runDashboardImport(args.slice(1))
      : validateDashboards();
  writeJson(result);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  dashboardImportPlan,
  dashboardCommand,
  dashboardKqlCheck,
  dashboardVerify,
  runDashboardImport,
  substituteGrafanaMacros,
  validateDashboardContentGuardrails,
  validateDashboardLinks,
  validateDashboardFilters,
  validateDashboardUx,
  validateDashboards
};
