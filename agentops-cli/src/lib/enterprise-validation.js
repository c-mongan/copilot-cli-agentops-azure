const fs = require('node:fs');
const path = require('node:path');
const { repoRoot } = require('./paths');
const { readAgentOpsConfig } = require('./agentops-config');

function repoFileText(relativePath, options = {}) {
  const base = options.root || repoRoot;
  const fullPath = path.join(base, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}

function enterpriseCheck(name, ok, severity, detail) {
  return { name, ok: Boolean(ok), severity, detail };
}

function validateEnterprise(options = {}) {
  const env = options.env || process.env;
  const config = options.config || readAgentOpsConfig({ configPath: options.configPath, quiet: true }).values;
  const mainBicep = repoFileText('infra/bicep/main.bicep', options);
  const logAnalyticsBicep = repoFileText('infra/bicep/log-analytics.bicep', options);
  const grafanaBicep = repoFileText('infra/bicep/grafana.bicep', options);
  const keyVaultBicep = repoFileText('infra/bicep/key-vault.bicep', options);
  const appInsightsBicep = repoFileText('infra/bicep/app-insights.bicep', options);
  const alertsBicep = repoFileText('infra/bicep/alerts.bicep', options);
  const rbacBicep = repoFileText('infra/bicep/rbac.bicep', options);
  const budgetBicep = repoFileText('infra/bicep/budget.bicep', options);
  const datasourceProvisioning = repoFileText('grafana/provisioning/datasources/azure-monitor.yaml', options);
  const azureCollector = repoFileText('collector/otelcol.azuremonitor.yaml', options);
  const azureCompose = repoFileText('collector/docker-compose.azuremonitor.yaml', options);
  const azureWhatIf = repoFileText('scripts/azure-what-if.sh', options);
  const enterpriseDeploy = repoFileText('scripts/azure-deploy-enterprise-pilot.sh', options);
  const readme = repoFileText('README.md', options);
  const enterprisePilot = repoFileText('docs/enterprise-pilot.md', options);
  const azureProdHardening = repoFileText('docs/azure-production-hardening.md', options);
  const threatModel = repoFileText('docs/threat-model.md', options);

  const checks = [
    enterpriseCheck(
      'deployment-profiles',
      /param deploymentProfile string/.test(mainBicep) && /'dev'/.test(mainBicep) && /'team'/.test(mainBicep) && /'enterprise'/.test(mainBicep),
      'high',
      'Bicep exposes dev/team/enterprise profiles.'
    ),
    enterpriseCheck(
      'daily-ingestion-cap',
      /dailyIngestionCapGb/.test(mainBicep) && /workspaceCapping/.test(logAnalyticsBicep) && /dailyQuotaGb/.test(logAnalyticsBicep),
      'critical',
      'Log Analytics has a default daily ingestion cap as a spike guardrail.'
    ),
    enterpriseCheck(
      'retention-parameter',
      /logRetentionDays/.test(mainBicep) && /retentionInDays/.test(logAnalyticsBicep),
      'high',
      'Retention is explicit and profile-driven.'
    ),
    enterpriseCheck(
      'metadata-only-tags',
      /telemetryContent: 'metadata-only'/.test(mainBicep),
      'medium',
      'Azure resources are tagged as metadata-only telemetry.'
    ),
    enterpriseCheck(
      'actioner-disabled-default',
      /param deployActioner bool = false/.test(mainBicep),
      'critical',
      'Actioning workflows are opt-in, not enabled by default.'
    ),
    enterpriseCheck(
      'alerts-disabled-default',
      /param deployAlerts bool = false/.test(mainBicep) && /param enableAlerts bool = false/.test(mainBicep),
      'high',
      'Alerts are opt-in until thresholds and action groups are tuned.'
    ),
    enterpriseCheck(
      'rbac-disabled-default',
      /param deployRbacAssignments bool = false/.test(mainBicep),
      'high',
      'RBAC assignment automation is opt-in because it mutates access control.'
    ),
    enterpriseCheck(
      'budget-disabled-default',
      /param deployBudget bool = false/.test(mainBicep) && /budgetContactEmails/.test(mainBicep),
      'high',
      'Budget creation is opt-in and requires explicit contact emails.'
    ),
    enterpriseCheck(
      'collector-localhost-published',
      /127\.0\.0\.1:4318:4318/.test(azureCompose) && /127\.0\.0\.1:4317:4317/.test(azureCompose),
      'critical',
      'Docker publishes OTLP only on localhost.'
    ),
    enterpriseCheck(
      'collector-content-scrub',
      [
        'gen_ai.input.messages',
        'gen_ai.output.messages',
        'gen_ai.prompt',
        'gen_ai.completion',
        'gen_ai.tool.call.arguments',
        'gen_ai.tool.call.result',
        'http.request.body.content',
        'http.response.body.content'
      ].every(key => azureCollector.includes(key)) && /action: delete/.test(azureCollector),
      'critical',
      'Collector deletes prompt, response, tool payload, URL, and body content before Azure export.'
    ),
    enterpriseCheck(
      'content-capture-env-off',
      String(env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT || '').toLowerCase() !== 'true' &&
        String(env.COPILOT_OTEL_CAPTURE_CONTENT || '').toLowerCase() !== 'true',
      'critical',
      'Content capture is not enabled in this environment.'
    ),
    enterpriseCheck(
      'grafana-api-keys-disabled',
      /apiKey: 'Disabled'/.test(grafanaBicep),
      'high',
      'Azure Managed Grafana API keys are disabled.'
    ),
    enterpriseCheck(
      'grafana-managed-identity',
      /identity:\s*{\s*type: 'SystemAssigned'/s.test(grafanaBicep) && /azureAuthType: msi/.test(datasourceProvisioning),
      'high',
      'Managed Grafana and the Azure Monitor datasource use managed identity auth.'
    ),
    enterpriseCheck(
      'grafana-network-posture-params',
      /param grafanaPublicNetworkAccess string/.test(mainBicep) &&
        /param grafanaZoneRedundancy string/.test(mainBicep) &&
        /publicNetworkAccess: publicNetworkAccess/.test(grafanaBicep) &&
        /zoneRedundancy: zoneRedundancy/.test(grafanaBicep),
      'medium',
      'Grafana public access and zone redundancy are explicit deployment choices.'
    ),
    enterpriseCheck(
      'alert-action-groups-parameter',
      /param alertActionGroupResourceIds array/.test(mainBicep) &&
        /param actionGroupResourceIds array/.test(alertsBicep) &&
        /actionGroups: actionGroupResourceIds/.test(alertsBicep),
      'high',
      'Alert routing uses explicit Azure Monitor action group resource IDs.'
    ),
    enterpriseCheck(
      'key-vault-rbac-purge-protection',
      /enableRbacAuthorization: true/.test(keyVaultBicep) && /enablePurgeProtection: true/.test(keyVaultBicep),
      'high',
      'Key Vault uses RBAC authorization and purge protection.'
    ),
    enterpriseCheck(
      'log-access-resource-permissions',
      /enableLogAccessUsingOnlyResourcePermissions: true/.test(logAnalyticsBicep),
      'high',
      'Log Analytics access follows resource permissions.'
    ),
    enterpriseCheck(
      'app-insights-workspace-based',
      /WorkspaceResourceId/.test(appInsightsBicep) && /IngestionMode: 'LogAnalytics'/.test(appInsightsBicep),
      'high',
      'Application Insights is workspace-based for central query and retention control.'
    ),
    enterpriseCheck(
      'least-privilege-rbac-module',
      /Microsoft\.Authorization\/roleAssignments@2022-04-01/.test(rbacBicep) &&
        /principalType: 'Group'/.test(rbacBicep) &&
        /3b03c2da-16b3-4a49-8834-0f8130efdd3b/.test(rbacBicep) &&
        /60921a7e-fef1-4a43-9b16-a26c52ad4769/.test(rbacBicep),
      'high',
      'Optional RBAC module assigns least-privilege roles to Entra security groups.'
    ),
    enterpriseCheck(
      'budget-module',
      /Microsoft\.Consumption\/budgets@/.test(budgetBicep) &&
        /Actual_GreaterThan_80_Percent/.test(budgetBicep) &&
        /Actual_GreaterThan_100_Percent/.test(budgetBicep),
      'high',
      'Optional budget module alerts owners at 80 percent and 100 percent.'
    ),
    enterpriseCheck(
      'what-if-enterprise-params',
      /AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS/.test(azureWhatIf) &&
        /AGENTOPS_DEPLOY_BUDGET/.test(azureWhatIf) &&
        /AGENTOPS_BUDGET_CONTACT_EMAILS/.test(azureWhatIf) &&
        /AGENTOPS_DEPLOY_ALERTS/.test(azureWhatIf) &&
        /AGENTOPS_ENABLE_ALERTS/.test(azureWhatIf) &&
        /AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS/.test(azureWhatIf) &&
        /AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS/.test(azureWhatIf),
      'medium',
      'what-if supports RBAC, budget, alert routing, and Grafana network posture parameters.'
    ),
    enterpriseCheck(
      'enterprise-deploy-script',
      /az deployment group create/.test(enterpriseDeploy) &&
        /AGENTOPS_DEPLOY_RBAC_ASSIGNMENTS/.test(enterpriseDeploy) &&
        /AGENTOPS_DEPLOY_BUDGET/.test(enterpriseDeploy) &&
        /AGENTOPS_DEPLOY_ALERTS/.test(enterpriseDeploy) &&
        /AGENTOPS_ENABLE_ALERTS/.test(enterpriseDeploy) &&
        /AGENTOPS_ALERT_ACTION_GROUP_RESOURCE_IDS/.test(enterpriseDeploy) &&
        /AGENTOPS_GRAFANA_PUBLIC_NETWORK_ACCESS/.test(enterpriseDeploy),
      'medium',
      'Enterprise pilot script deploys the same RBAC, budget, alert, and Grafana posture parameters reviewed by what-if.'
    ),
    enterpriseCheck(
      'connection-string-not-configured',
      !Object.keys(config).some(key => /connection|string|instrumentation/i.test(key)),
      'critical',
      'Local AgentOps config stores names/IDs, not connection strings.'
    ),
    enterpriseCheck(
      'azd-no-connection-string-output',
      !/output APPLICATIONINSIGHTS_CONNECTION_STRING/.test(mainBicep),
      'critical',
      'azd outputs do not persist the Application Insights connection string.'
    ),
    enterpriseCheck(
      'azd-outputs-importable',
      /output APPLICATIONINSIGHTS_NAME/.test(mainBicep) &&
        /output LOG_ANALYTICS_DAILY_QUOTA_GB/.test(mainBicep) &&
        /output GRAFANA_ENDPOINT/.test(mainBicep),
      'medium',
      'azd outputs include names, endpoints, and cost guardrail values.'
    ),
    enterpriseCheck(
      'enterprise-docs',
      /Enterprise-safe, cost-bounded setup/.test(readme),
      'medium',
      'README documents the enterprise-safe path.'
    ),
    enterpriseCheck(
      'pilot-review-docs',
      /Data Classification/.test(enterprisePilot) &&
        /Review Checklist/.test(enterprisePilot) &&
        /Rollback/.test(enterprisePilot),
      'medium',
      'Enterprise pilot guide documents data classification, review, and rollback.'
    ),
    enterpriseCheck(
      'azure-production-hardening-docs',
      /Managed Grafana Access/i.test(azureProdHardening) &&
        /Log Analytics Posture/i.test(azureProdHardening) &&
        /Alert Routing/i.test(azureProdHardening) &&
        /Private Access/i.test(azureProdHardening),
      'medium',
      'Azure production hardening doc covers Grafana access, Log Analytics, alert routing, and private access.'
    ),
    enterpriseCheck(
      'threat-model',
      /Trust Boundaries/.test(threatModel) &&
        /Threats And Mitigations/.test(threatModel) &&
        /Residual Risk/.test(threatModel),
      'medium',
      'Threat model documents boundaries, mitigations, and residual risk.'
    )
  ];

  const blocking = checks.filter(check => !check.ok && check.severity !== 'warning');
  const warnings = checks.filter(check => !check.ok && check.severity === 'warning');
  const score = Math.max(0, 100 - blocking.length * 8 - warnings.length * 3);
  const next = [];

  if (blocking.length === 0) {
    next.push('Run agentops validate-azure --profile internal --remediation-plan --json to decide whether the live Azure environment is pilot-ready.');
    next.push('Run ./scripts/azure-what-if.sh and review retention/cap values before azd provision.');
    next.push('Run agentops collector smoke --privacy strict --poison after provisioning.');
  } else {
    next.push('Fix failed critical/high checks before enterprise rollout.');
  }

  return {
    ok: blocking.length === 0,
    score,
    score_kind: 'local-blueprint',
    validation_scope: 'local deployment files, configuration, and process environment',
    live_environment_checked: false,
    enterprise_pilot_ready: false,
    readiness_statement: blocking.length === 0
      ? 'The local enterprise blueprint passed. This does not prove the deployed Azure environment is enterprise-pilot ready.'
      : 'The local enterprise blueprint is incomplete. The deployed Azure environment was not checked.',
    checks,
    failed: blocking.map(check => check.name),
    warnings: warnings.map(check => check.name),
    next
  };
}

function renderValidateEnterprise(result) {
  const lines = [
    'AgentOps enterprise blueprint validation',
    '',
    `Blueprint score: ${result.score}/100.`,
    `Live Azure checked: ${result.live_environment_checked ? 'yes' : 'no'}.`,
    `Enterprise pilot ready: ${result.enterprise_pilot_ready ? 'yes' : 'not proven'}.`,
    result.readiness_statement
  ];
  for (const check of result.checks) {
    const status = check.ok ? 'ok' : 'failed';
    lines.push(`- ${check.name}: ${status} [${check.severity}]${check.detail ? ` (${check.detail})` : ''}`);
  }
  lines.push('', result.ok ? 'Local enterprise guardrails passed.' : 'Local enterprise guardrails are incomplete.');
  lines.push('Next:');
  for (const item of result.next) lines.push(`- ${item}`);
  return `${lines.join('\n')}\n`;
}


module.exports = {
  renderValidateEnterprise,
  validateEnterprise
};
