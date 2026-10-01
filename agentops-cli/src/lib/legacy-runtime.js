const os = require('node:os');
const path = require('node:path');
const { createAlerts } = require('../alerts');
const { createPrimitives } = require('../primitives');
const { createRecommendations } = require('../recommendations');
const { createSavedViews } = require('../saved-views');
const { createTelemetry } = require('../telemetry');
const { readJson } = require('./json');
const { defaultUserAgentOpsPath, repoRoot } = require('./paths');
const { usage } = require('./usage');
const { createLocalStatus } = require('./local-status');
const { createCoreCommand } = require('./core-command');
const { escapeKqlString, validateKqlDuration } = require('./kql');
const {
  attributionUsageQuery,
  baseFilter,
  collectorHealthQuery,
  contextPressureQuery,
  directSessionKey,
  encodeGrafanaValue,
  fallbackSessionKey,
  fieldCatalogQuery,
  grafanaUrlWithVars,
  kqlFileQuery,
  logAnalyticsTargetWarning,
  otelCompatibilityQuery,
  sessionKey,
  sessionQuery,
  tokenRollupAuditQuery,
  traceQuery
} = require('./observability-queries');
const {
  agentopsConfigure,
  compactConfig,
  configFromEnvValues,
  configuredCloudValues: configuredCloudValuesFromConfig,
  parseConfigureArgs,
  parseConfigureSetArgs,
  parseEnvAssignments,
  readAgentOpsConfig,
  renderConfigure,
  writeAgentOpsConfig
} = require('./agentops-config');
const {
  buildOtelSetup,
  parseOtelSetupArgs,
  renderOtelSetup
} = require('./otel-setup');
const { createCommandRuntime } = require('./command-runtime');
const {
  agentInstallTarget,
  installDefaultAgents,
  installDefaultSkills,
  installPlugin,
  listDefaultAgents,
  listDefaultSkills,
  parseFrontmatter,
  plural,
  renderAgentsInstall,
  renderAgentsUninstall,
  renderPluginInstall,
  renderPluginUninstall,
  renderSkillsInstall,
  renderSkillsUninstall,
  skillInstallTarget,
  uninstallDefaultAgents,
  uninstallDefaultSkills,
  uninstallPlugin
} = require('./plugin-assets');
const { createPluginAssetCommand } = require('./plugin-asset-command');
const {
  agentopsWorkflows,
  parseWorkflowsArgs,
  renderWorkflow,
  renderWorkflowsList
} = require('./workflows');
const { createWorkflowCommand } = require('./workflow-command');
const { createUtilityCommand } = require('./utility-command');
const { checkAzureSubscription } = require('./azure/subscription-guard');
const {
  parseBenchmarkApproveArgs,
  parseBenchmarkArtifactsArgs,
  parseBenchmarkCompareArgs: parseBenchmarkCompareArgsBase,
  parseBenchmarkFixturePackArgs,
  parseBenchmarkReportArgs: parseBenchmarkReportArgsBase,
  parseBenchmarkRunArgs
} = require('./benchmark-args');
const {
  benchmarkCheatSignals,
  numberValue,
  roundNumber
} = require('./benchmark-scoring');
const {
  benchmarkFixturePack,
  listBenchmarks: listBenchmarksBase,
  loadBenchmarkSuites: loadBenchmarkSuitesBase,
  validateBenchmarkTask: validateBenchmarkTaskBase
} = require('./benchmark-validation');
const {
  benchmarkRunPlan: benchmarkRunPlanBase,
  runBenchmarkSuite: runBenchmarkSuiteBase
} = require('./benchmark-execution');
const {
  benchmarkApproval
} = require('./benchmark-approval');
const {
  benchmarkAzureTelemetry: benchmarkAzureTelemetryBase,
  benchmarkAzureTelemetryQuery,
  enrichBenchmarkSummariesWithAzure: enrichBenchmarkSummariesWithAzureBase
} = require('./benchmark-azure-telemetry');
const {
  benchmarkArtifactReview: benchmarkArtifactReviewBase,
  benchmarkReport: benchmarkReportBase,
  compareBenchmarkRuns: compareBenchmarkRunsBase,
  defaultBenchmarkSummaryDir: defaultBenchmarkSummaryDirBase,
  loadBenchmarkSummaries: loadBenchmarkSummariesBase
} = require('./benchmark-report');
const { createBenchmarkContext } = require('./benchmark-context');
const {
  benchmarkJudgeProviderGuide,
  renderBenchmarkJudgeProviderGuide
} = require('./benchmark-judge-guide');
const { createBenchmarkCommand } = require('./benchmark-command');
const { createObservabilityQueryCommand } = require('./observability-query-command');
const {
  coActivationQuery,
  readOrderQuery,
  repeatedToolsQuery,
  slowScriptsQuery
} = require('./local-investigation-queries');
const {
  attributionSmokeId,
  createSmokeContext,
  liveReplaySmokeId,
  otlpAttributionSmokeTracePayload,
  otlpLiveReplaySmokeTracePayload,
  otlpSmokeTracePayload,
  parseSmokeArgs,
  realCopilotSmokeCommand,
  renderSmoke,
  smokeId
} = require('./smoke');
const { createSmokeCommand } = require('./smoke-command');
const {
  createCustomTelemetryContext,
  customAzureQuery,
  customEventAttributes,
  customEventId,
  importJsonl,
  otlpCustomEventPayload,
  parseAnnotationArgs,
  parseCustomArgs,
  renderCustom
} = require('./custom-telemetry');
const { createCustomTelemetryCommand } = require('./custom-telemetry-command');
const { createSessionSummary } = require('./session-summary');
const { createSessionCommand } = require('./session-command');
const { createAskContext } = require('./ask-context');
const { createCollectorValidation } = require('./collector-validation');
const {
  durationToMs,
  optionValue,
  optionValues,
  parseLastArg,
  parseSkillsArgs
} = require('./cli-options');
const { createCloudValidation } = require('./cloud-validation');
const { createAlertActions } = require('./alert-actions');
const { createAlertCommand } = require('./alert-command');
const { createSetupInit } = require('./setup-init');
const { createPlannedCommand } = require('./planned-command');
const {
  agentOpsScheduledQueryRules,
  azAvailable,
  azErrorDetail,
  parseJsonOutput,
  renderValidateAzure,
  validateAzure: validateAzureBase,
  runAz
} = require('./azure-validation');

const root = repoRoot;

const agentopsConfig = readAgentOpsConfig({ quiet: true }).values;
const configuredWorkspaceId = process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_ID || process.env.LOG_ANALYTICS_WORKSPACE_ID || agentopsConfig.workspaceId || '';
const workspaceId = configuredWorkspaceId || '00000000-0000-0000-0000-000000000000';
const grafanaBaseUrl = (process.env.AGENTOPS_GRAFANA_BASE_URL || agentopsConfig.grafanaBaseUrl || 'https://your-grafana.grafana.azure.com').replace(/\/$/, '');
const mainGrafanaDashboardUrl = `${grafanaBaseUrl}/d/copilot-agentops/copilot-cli-agentops`;
const sessionsGrafanaDashboardUrl = `${grafanaBaseUrl}/d/agentops-sessions/agentops-sessions`;
const v2HomeGrafanaDashboardUrl = `${grafanaBaseUrl}/d/agentops-v2-home`;
const v2RunsGrafanaDashboardUrl = `${grafanaBaseUrl}/d/agentops-v2-runs-explorer`;
const v2ReplayGrafanaDashboardUrl = `${grafanaBaseUrl}/d/agentops-v2-run-replay`;
const grafanaDatasourceUid = process.env.AGENTOPS_GRAFANA_DATASOURCE_UID || agentopsConfig.grafanaDatasourceUid || 'azure-monitor-oob';
const agentsViewUrl = process.env.AGENTOPS_AZURE_AGENTS_URL || agentopsConfig.agentsViewUrl || '';
const cloudVerified = process.env.AGENTOPS_AZURE_CLOUD_VERIFIED === 'true';
const azureSubscriptionId = process.env.AGENTOPS_AZURE_SUBSCRIPTION_ID || process.env.AZURE_SUBSCRIPTION_ID || agentopsConfig.subscriptionId || '00000000-0000-0000-0000-000000000000';
const azureResourceGroup = process.env.AGENTOPS_AZURE_RESOURCE_GROUP || process.env.AZURE_RESOURCE_GROUP || agentopsConfig.resourceGroup || 'rg-agentops-dev';
const appInsightsName = process.env.APPLICATIONINSIGHTS_NAME || process.env.AGENTOPS_APPLICATIONINSIGHTS_NAME || agentopsConfig.appInsightsName || '';
const appInsightsResourceUrl = appInsightsName && azureSubscriptionId && azureResourceGroup
  ? `https://portal.azure.com/#@/resource/subscriptions/${encodeURIComponent(azureSubscriptionId)}/resourceGroups/${encodeURIComponent(azureResourceGroup)}/providers/microsoft.insights/components/${encodeURIComponent(appInsightsName)}/overview`
  : '';
const logAnalyticsWorkspaceName = process.env.AGENTOPS_LOG_ANALYTICS_WORKSPACE_NAME || agentopsConfig.workspaceName || 'law-agentops-dev';
const portalLogsUrl = process.env.AGENTOPS_AZURE_PORTAL_LOGS_URL || agentopsConfig.portalLogsUrl || `https://portal.azure.com/#@/resource/subscriptions/${azureSubscriptionId}/resourceGroups/${azureResourceGroup}/providers/Microsoft.OperationalInsights/workspaces/${logAnalyticsWorkspaceName}/logs`;
const defaultInstallDir = process.env.AGENTOPS_BIN_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '', '.local', 'bin');
const benchmarksDir = path.join(root, 'benchmarks');
const benchmarkRunBaseDir = path.join(os.tmpdir(), 'agentops-benchmark-runs');
const savedViewsPath = process.env.AGENTOPS_VIEWS_PATH || defaultUserAgentOpsPath('views.json');

const {
  agentopsStatusSummary,
  commandCandidates,
  doctor,
  installedShimStatus,
  renderStatus,
  scan
} = createLocalStatus({ defaultInstallDir, root });

const {
  configuredCloudValues,
  flattenGrafanaList,
  grafanaDashboardImportCommand,
  grafanaItemUid,
  isConfiguredValue,
  listGrafanaDashboardFiles,
  runGrafanaDashboardImportRemediation,
  validateAzure
} = createCloudValidation({
  azureResourceGroup,
  configuredCloudValuesFromConfig,
  grafanaDatasourceUid,
  logAnalyticsWorkspaceName,
  readJson,
  root,
  runAzureLogAnalyticsQuery: (...args) => runAzureLogAnalyticsQuery(...args),
  validateAzureBase
});

const {
  buildLink,
  commandPlan,
  runPlannedCommand
} = createCommandRuntime({
  commandCandidates,
  configuredCloudValues,
  grafanaBaseUrl,
  portalLogsUrl,
  root,
  workspaceId
});

const {
  agentopsInit,
  agentopsSetupGuide,
  parseInitArgs,
  parseSetupArgs,
  renderInit,
  renderSetupGuide
} = createSetupInit({
  agentopsConfigure,
  agentopsStatusSummary,
  checkAzureSubscription,
  commandCandidates,
  configFromEnvValues,
  configuredCloudValues,
  defaultInstallDir,
  doctor,
  durationToMs,
  grafanaDashboardImportCommand,
  installDefaultAgents,
  installDefaultSkills,
  installedShimStatus,
  isConfiguredValue,
  optionValue,
  parseEnvAssignments,
  plural,
  realCopilotSmokeCommand,
  validateAzure
});

const {
  renderValidateEnterprise,
  validateEnterprise
} = require('./enterprise-validation');
const { createValidationCommand } = require('./validation-command');

const {
  attributeValue,
  explainLatest,
  isFailedRow,
  isSpanTelemetryRow,
  latestAzureSessionSummary,
  latestSessionAzureQuery,
  latestSessionSummary,
  latestSummaryFromArgs,
  numberAttribute,
  openLinksSummary,
  operationFromRow,
  readJsonlRows,
  renderExplanation,
  renderLatest,
  rowAttributes,
  telemetryTime,
  runAzureLogAnalyticsQuery,
  sessionFromRow,
  summarizeSession
} = createSessionSummary({
  buildLink,
  appInsightsResourceUrl,
  cloudVerified,
  configuredWorkspaceId,
  agentsViewUrl,
  mainGrafanaDashboardUrl,
  optionValue,
  parseLastArg,
  sessionsGrafanaDashboardUrl,
  v2HomeGrafanaDashboardUrl,
  v2ReplayGrafanaDashboardUrl,
  v2RunsGrafanaDashboardUrl,
  workspaceId
});

const {
  askAgentOpsContext,
  parseAskContextArgs,
  renderAskContext
} = createAskContext({
  buildLink,
  latestSessionAzureQuery,
  latestSummaryFromArgs,
  parseLastArg,
  portalLogsUrl,
  sessionsGrafanaDashboardUrl,
  validateKqlDuration,
  workspaceId
});

const {
  renderOpenLinks,
  validateCollector
} = createCollectorValidation({
  openLinksSummary
});

const {
  validationCommand,
  validationCommandNames
} = createValidationCommand({
  parseLastArg,
  renderValidateAzure,
  renderValidateEnterprise,
  validateAzure,
  validateCollector,
  validateEnterprise
});

const {
  alertRecommendationQuery,
  alertRecommendations,
  alertTunePlan,
  alertResourceState,
  alertPolicy,
  alertHistoryQuery,
  alertHistory,
  alertDetail,
  alertActionPlan,
  alertArtifact,
  alertIncidentTimeline,
  alertHandoff,
  alertRoutePlan
} = createAlerts({
  workspaceId,
  baseFilter,
  sessionKey,
  validateKqlDuration,
  buildLink
});

const {
  recommendationForExplanation,
  renderRecommendation
} = createRecommendations({
  buildLink,
  mainGrafanaDashboardUrl,
  latestSessionAzureQuery
});

const {
  alertActionGroupPlan,
  alertActionGroupRoute,
  alertAzureDevOpsWorkItemRoute,
  alertGithubIssueRoute,
  alertOpenRun,
  alertReview,
  alertThresholdPatch,
  alertThresholdSimulation
} = createAlertActions({
  alertActionPlan,
  alertArtifact,
  alertDetail,
  alertHandoff,
  alertHistoryQuery,
  alertRecommendationQuery,
  alertRoutePlan,
  alertTunePlan,
  baseFilter,
  grafanaUrlWithVars,
  root,
  sessionKey,
  validateKqlDuration,
  v2ReplayGrafanaDashboardUrl,
  v2RunsGrafanaDashboardUrl
});

const {
  alertCommand,
  incidentCommand
} = createAlertCommand({
  agentOpsScheduledQueryRules,
  alertActionGroupPlan,
  alertActionGroupRoute,
  alertActionPlan,
  alertArtifact,
  alertAzureDevOpsWorkItemRoute,
  alertDetail,
  alertGithubIssueRoute,
  alertHandoff,
  alertHistory,
  alertIncidentTimeline,
  alertOpenRun,
  alertPolicy,
  alertRecommendations,
  alertResourceState,
  alertReview,
  alertRoutePlan,
  alertThresholdPatch,
  alertThresholdSimulation,
  alertTunePlan,
  azAvailable,
  azErrorDetail,
  configuredCloudValues,
  optionValue,
  optionValues,
  parseJsonOutput,
  parseLastArg,
  readJsonlRows,
  runAz
});

const {
  copilotPrimitivesInventory
} = createPrimitives({
  root,
  workspaceId,
  kqlFileQuery,
  validateKqlDuration,
  optionValue
});

const {
  liveViewFromArgs,
  replayTimeline,
  renderLive,
  renderReplay,
  sleep,
  spanRowsFromSource
} = createTelemetry({
  optionValue,
  parseLastArg,
  readJsonlRows,
  validateKqlDuration,
  latestSessionAzureQuery,
  runAzureLogAnalyticsQuery,
  rowAttributes,
  operationFromRow,
  attributeValue,
  numberAttribute,
  isFailedRow,
  isSpanTelemetryRow,
  sessionFromRow,
  telemetryTime,
  numberValue,
  roundNumber
});

const {
  sessionCommand,
  sessionCommandNames
} = createSessionCommand({
  explainLatest,
  latestSummaryFromArgs,
  liveViewFromArgs,
  openLinksSummary,
  optionValue,
  parseLastArg,
  recommendationForExplanation,
  renderExplanation,
  renderLatest,
  renderLive,
  renderOpenLinks,
  renderRecommendation,
  renderReplay,
  replayTimeline,
  runAzureLogAnalyticsQuery,
  sessionQuery,
  sleep,
  spanRowsFromSource,
  validateKqlDuration
});

const {
  agentopsAttributionSmoke,
  agentopsLiveReplaySmoke,
  agentopsSmoke,
  verifySmokeInAzure
} = createSmokeContext({
  defaultWorkspaceId: workspaceId,
  grafanaBaseUrl,
  latestSummaryFromArgs,
  openLinksSummary,
  runAzureLogAnalyticsQuery,
  sleep
});

const {
  smokeCommand,
  smokeCommandNames
} = createSmokeCommand({
  agentopsAttributionSmoke,
  agentopsLiveReplaySmoke,
  agentopsSmoke,
  parseSmokeArgs,
  renderSmoke
});

const {
  agentopsAnnotationConfigChange,
  agentopsCustomEmit,
  agentopsCustomImport
} = createCustomTelemetryContext({
  defaultWorkspaceId: workspaceId
});

const {
  customTelemetryCommand,
  customTelemetryCommandNames
} = createCustomTelemetryCommand({
  agentopsAnnotationConfigChange,
  agentopsCustomEmit,
  agentopsCustomImport,
  parseAnnotationArgs,
  parseCustomArgs,
  renderCustom
});

const {
  parseSavedViewArgs,
  readSavedViews,
  savedViewCommand
} = createSavedViews({
  savedViewsPath,
  readJson,
  buildLink
});

const {
  benchmarkArtifactReview,
  benchmarkAzureTelemetry,
  benchmarkReport,
  benchmarkRunPlan,
  compareBenchmarkRuns,
  defaultBenchmarkSummaryDir,
  enrichBenchmarkSummariesWithAzure,
  listBenchmarks,
  loadBenchmarkSummaries,
  loadBenchmarkSuites,
  parseBenchmarkCompareArgs,
  parseBenchmarkReportArgs,
  runBenchmarkSuite,
  validateBenchmarkTask
} = createBenchmarkContext({
  benchmarkArtifactReviewBase,
  benchmarkAzureTelemetryBase,
  benchmarkReportBase,
  benchmarkRunBaseDir,
  benchmarkRunPlanBase,
  benchmarksDir,
  compareBenchmarkRunsBase,
  defaultBenchmarkSummaryDirBase,
  enrichBenchmarkSummariesWithAzureBase,
  listBenchmarksBase,
  loadBenchmarkSummariesBase,
  loadBenchmarkSuitesBase,
  parseBenchmarkCompareArgsBase,
  parseBenchmarkReportArgsBase,
  root,
  runAzureLogAnalyticsQuery,
  runBenchmarkSuiteBase,
  validateBenchmarkTaskBase,
  validateKqlDuration
});

const {
  benchmarkCommand
} = createBenchmarkCommand({
  benchmarkApproval,
  benchmarkArtifactReview,
  benchmarkFixturePack,
  benchmarkJudgeProviderGuide,
  benchmarkReport,
  compareBenchmarkRuns,
  listBenchmarks,
  parseBenchmarkApproveArgs,
  parseBenchmarkArtifactsArgs,
  parseBenchmarkCompareArgs,
  parseBenchmarkFixturePackArgs,
  parseBenchmarkReportArgs,
  parseBenchmarkRunArgs,
  renderBenchmarkJudgeProviderGuide,
  runBenchmarkSuite
});

const {
  pluginAssetCommand,
  pluginAssetCommandNames
} = createPluginAssetCommand({
  agentInstallTarget,
  installDefaultAgents,
  installDefaultSkills,
  installPlugin,
  listDefaultAgents,
  listDefaultSkills,
  parseSkillsArgs,
  renderAgentsInstall,
  renderAgentsUninstall,
  renderPluginInstall,
  renderPluginUninstall,
  renderSkillsInstall,
  renderSkillsUninstall,
  skillInstallTarget,
  uninstallDefaultAgents,
  uninstallDefaultSkills,
  uninstallPlugin
});

const {
  queryCommand,
  queryCommandNames
} = createObservabilityQueryCommand({
  attributionUsageQuery,
  buildLink,
  coActivationQuery,
  collectorHealthQuery,
  contextPressureQuery,
  fieldCatalogQuery,
  kqlFileQuery,
  logAnalyticsTargetWarning,
  otelCompatibilityQuery,
  parseLastArg,
  readOrderQuery,
  repeatedToolsQuery,
  slowScriptsQuery,
  tokenRollupAuditQuery,
  workspaceId
});

const { workflowCommand } = createWorkflowCommand({
  agentopsWorkflows,
  parseWorkflowsArgs,
  renderWorkflow,
  renderWorkflowsList
});

const {
  utilityCommand,
  utilityCommandNames
} = createUtilityCommand({
  copilotPrimitivesInventory,
  doctor,
  importJsonl,
  parseSavedViewArgs,
  savedViewCommand,
  scan
});

const {
  coreCommand,
  coreCommandNames
} = createCoreCommand({
  agentopsConfigure,
  agentopsInit,
  agentopsSetupGuide,
  askAgentOpsContext,
  buildOtelSetup,
  parseAskContextArgs,
  parseConfigureArgs,
  parseInitArgs,
  parseOtelSetupArgs,
  parseSetupArgs,
  renderAskContext,
  renderConfigure,
  renderInit,
  renderOtelSetup,
  renderSetupGuide,
  renderStatus
});

const {
  plannedCommand,
  plannedCommandNames
} = createPlannedCommand({
  commandPlan,
  runPlannedCommand
});

async function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }

  if (coreCommandNames.includes(command)) {
    coreCommand(command, args);
    return;
  }

  if (sessionCommandNames.includes(command)) {
    await sessionCommand(command, args);
    return;
  }

  if (command === 'workflows') {
    workflowCommand(args);
    return;
  }

  if (pluginAssetCommandNames.includes(command)) {
    pluginAssetCommand(command, args);
    return;
  }

  if (utilityCommandNames.includes(command)) {
    utilityCommand(command, args);
    return;
  }

  if (customTelemetryCommandNames.includes(command)) {
    await customTelemetryCommand(command, args);
    return;
  }

  if (validationCommandNames.includes(command)) {
    await validationCommand(command, args);
    return;
  }

  if (smokeCommandNames.includes(command)) {
    await smokeCommand(command, args);
    return;
  }

  if (plannedCommandNames.includes(command)) {
    plannedCommand(command, args);
    return;
  }

  if (command === 'benchmark') {
    benchmarkCommand(args);
    return;
  }

  if (queryCommandNames.includes(command)) {
    queryCommand(command, args);
    return;
  }

  if (command === 'alert') {
    alertCommand(args);
    return;
  }

  if (command === 'incident') {
    incidentCommand(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  agentopsAttributionSmoke,
  agentopsInit,
  agentopsConfigure,
  agentopsSetupGuide,
  agentopsSmoke,
  agentopsLiveReplaySmoke,
  agentopsStatusSummary,
  agentopsWorkflows,
  alertRecommendationQuery,
  alertRecommendations,
  alertTunePlan,
  alertThresholdSimulation,
  alertThresholdPatch,
  alertResourceState,
  alertPolicy,
  alertHistoryQuery,
  alertHistory,
  alertDetail,
  alertOpenRun,
  alertReview,
  alertActionPlan,
  alertArtifact,
  alertActionGroupPlan,
  alertActionGroupRoute,
  alertIncidentTimeline,
  alertAzureDevOpsWorkItemRoute,
  alertHandoff,
  alertGithubIssueRoute,
  alertRoutePlan,
  askAgentOpsContext,
  attributionUsageQuery,
  benchmarkCheatSignals,
  benchmarkAzureTelemetry,
  benchmarkAzureTelemetryQuery,
  benchmarkApproval,
  benchmarkArtifactReview,
  benchmarkFixturePack,
  benchmarkJudgeProviderGuide,
  benchmarkReport,
  benchmarkRunBaseDir,
  benchmarkRunPlan,
  buildOtelSetup,
  buildLink,
  commandPlan,
  compareBenchmarkRuns,
  collectorHealthQuery,
  compactConfig,
  contextPressureQuery,
  copilotPrimitivesInventory,
  agentopsCustomEmit,
  agentopsCustomImport,
  agentopsAnnotationConfigChange,
  customAzureQuery,
  customEventAttributes,
  customEventId,
  doctor,
  durationToMs,
  explainLatest,
  fieldCatalogQuery,
  configFromEnvValues,
  importJsonl,
  installedShimStatus,
  agentInstallTarget,
  attributionSmokeId,
  liveReplaySmokeId,
  installDefaultAgents,
  installDefaultSkills,
  installPlugin,
  kqlFileQuery,
  latestAzureSessionSummary,
  latestSessionAzureQuery,
  latestSessionSummary,
  latestSummaryFromArgs,
  listGrafanaDashboardFiles,
  listDefaultAgents,
  listDefaultSkills,
  listBenchmarks,
  loadBenchmarkSummaries,
  loadBenchmarkSuites,
  liveViewFromArgs,
  openLinksSummary,
  otlpAttributionSmokeTracePayload,
  otlpCustomEventPayload,
  otlpLiveReplaySmokeTracePayload,
  parseBenchmarkCompareArgs,
  parseBenchmarkApproveArgs,
  parseBenchmarkArtifactsArgs,
  parseBenchmarkFixturePackArgs,
  parseBenchmarkReportArgs,
  parseBenchmarkRunArgs,
  parseConfigureArgs,
  parseConfigureSetArgs,
  parseCustomArgs,
  parseAnnotationArgs,
  parseEnvAssignments,
  parseOtelSetupArgs,
  parseFrontmatter,
  parseSavedViewArgs,
  parseSetupArgs,
  parseSmokeArgs,
  replayTimeline,
  renderExplanation,
  renderAskContext,
  renderConfigure,
  renderCustom,
  renderInit,
  renderLatest,
  renderLive,
  renderOpenLinks,
  renderOtelSetup,
  renderRecommendation,
  renderReplay,
  renderSetupGuide,
  renderSmoke,
  renderAgentsInstall,
  renderAgentsUninstall,
  renderBenchmarkJudgeProviderGuide,
  renderPluginInstall,
  renderPluginUninstall,
  renderSkillsInstall,
  renderSkillsUninstall,
  renderStatus,
  renderValidateEnterprise,
  renderValidateAzure,
  renderWorkflow,
  renderWorkflowsList,
  recommendationForExplanation,
  readAgentOpsConfig,
  readJsonlRows,
  readSavedViews,
  runAzureLogAnalyticsQuery,
  runBenchmarkSuite,
  savedViewCommand,
  scan,
  sessionQuery,
  spanRowsFromSource,
  skillInstallTarget,
  otelCompatibilityQuery,
  tokenRollupAuditQuery,
  enrichBenchmarkSummariesWithAzure,
  traceQuery,
  validateEnterprise,
  validateAzure,
  validateKqlDuration,
  validateBenchmarkTask,
  validateCollector,
  verifySmokeInAzure,
  uninstallDefaultAgents,
  uninstallDefaultSkills,
  uninstallPlugin,
  writeAgentOpsConfig
};
