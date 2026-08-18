const { validateDashboardLinks, validateDashboardUx, validateDashboards } = require('./dashboard-validation');
const { repoRoot } = require('./paths');
const { validateWrapperContract } = require('./copilot/wrapper-contract');
const { validateCopilotOtelFixtureContract } = require('./copilot/fixture-contract');
const { check, fileIncludes, requiredFilesCheck } = require('./product-audit-checks');

function defaultDashboardVerify(args, options) {
  return require('./dashboard-verify').dashboardVerify(args, options);
}

function defaultValidateAzure(options) {
  return require('../legacy').validateAzure(options);
}

function productAudit(options = {}) {
  const live = Boolean(options.live);
  const last = options.last || '24h';
  const requireRows = Boolean(options.requireRows);
  const runDashboardVerify = options.dashboardVerify || defaultDashboardVerify;
  const runValidateAzure = options.validateAzure || defaultValidateAzure;
  const checks = [];

  checks.push(requiredFilesCheck('agent-run-schema', [
    'docs/agent-run-data-model.md',
    'docs/otel-genai-mcp-schema.md',
    'agentops-cli/src/lib/schema/agent-run-schema.js',
    'agentops-cli/src/lib/schema/agentops-attributes.js',
    'agentops-cli/src/lib/otel/genai-normalizer.js',
    'agentops-cli/src/lib/otel/mcp-normalizer.js'
  ]));

  checks.push(requiredFilesCheck('strict-privacy-pipeline', [
    'collector/processors/strict-allowlist.yaml',
    'collector/processors/content-signal.yaml',
    'collector/processors/genai-normalizer.yaml',
    'collector/processors/mcp-normalizer.yaml',
    'collector/processors/span-to-run-summary.yaml',
    'collector/release-cadence.json',
    'collector/security-fixtures/privacy-poison-fixtures/content-poison.json',
    'agentops-cli/src/commands/content.js',
    'agentops-cli/src/lib/content-command.js',
    'agentops-cli/src/lib/content-status.js',
    'agentops-cli/src/lib/privacy.js',
    'agentops-cli/src/lib/azure/v2-ingest-plan.js',
    'docs/privacy-threat-model-v2.md'
  ]));

  checks.push(check(
    'privacy-defaults',
    fileIncludes('README.md', ['without recording prompts', 'tool arguments', 'tool results by default'])
      && fileIncludes('agentops-cli/src/lib/copilot/run-metadata.js', ['promptHash', 'commandHash'])
      && fileIncludes('copilot/copilot-observe', ['capture_content_enabled="${AGENTOPS_CAPTURE_CONTENT:-false}"', 'COPILOT_OTEL_CAPTURE_CONTENT="false"'])
      && fileIncludes('copilot/copilot-observe.ps1', ['$captureContentEnabled', 'COPILOT_OTEL_CAPTURE_CONTENT = "false"']),
    [
      'README.md',
      'agentops-cli/src/lib/copilot/run-metadata.js',
      'copilot/copilot-observe',
      'copilot/copilot-observe.ps1'
    ],
    []
  ));

  const wrapperContract = validateWrapperContract(repoRoot);
  checks.push(check(
    'copilot-wrapper-sync-contract',
    wrapperContract.ok,
    wrapperContract.files,
    wrapperContract.missing
  ));

  checks.push(requiredFilesCheck('copilot-cli-surface', [
    'agentops-cli/src/commands/copilot.js',
    'agentops-cli/src/lib/copilot/command.js',
    'agentops-cli/src/lib/copilot/resolve-real-copilot.js',
    'agentops-cli/src/lib/copilot/run-metadata.js',
    'agentops-cli/src/lib/copilot/flag-contract.js',
    'agentops-cli/src/lib/copilot/fixture-contract.js',
    'agentops-cli/src/lib/copilot/session-parser.js',
    'agentops-cli/src/lib/copilot/tool-classifier.js',
    'agentops-cli/src/lib/copilot/run-summary.js',
    'docs/copilot-cli-instrumentation.md',
    'docs/copilot-cli-flag-contract.md'
  ]));

  const copilotFixture = validateCopilotOtelFixtureContract();
  checks.push(check(
    'real-copilot-otel-fixture-contract',
    copilotFixture.ok && fileIncludes('docs/telemetry-schema.md', ['copilot-cli-wrapper-snapshot.ndjson.fixture', 'contract fixture']),
    [
      'fixtures/sample-otel/copilot-cli-wrapper-snapshot.ndjson.fixture',
      'agentops-cli/src/lib/copilot/fixture-contract.js',
      'docs/telemetry-schema.md'
    ],
    copilotFixture.mismatches
  ));

  checks.push(requiredFilesCheck('copilot-sdk-adapter', [
    'packages/agentops-copilot-sdk/package.json',
    'packages/agentops-copilot-sdk/src/index.js',
    'packages/agentops-copilot-sdk/src/createAgentOpsCopilotClient.js',
    'packages/agentops-copilot-sdk/src/hooks.js',
    'packages/agentops-copilot-sdk/src/otel.js',
    'packages/agentops-copilot-sdk/src/privacy.js',
    'packages/agentops-copilot-sdk/src/event-envelope.js',
    'packages/agentops-copilot-sdk/src/session-events.js',
    'packages/agentops-copilot-sdk/src/otlp-exporter.js',
    'packages/agentops-copilot-sdk/src/index.d.ts',
    'packages/agentops-copilot-sdk/examples/basic-sdk-agent/index.js',
    'docs/copilot-sdk-adapter.md'
  ]));

  const sdkOrderedEventsOk = fileIncludes('packages/agentops-copilot-sdk/src/event-envelope.js', [
      'createSafeEventNormalizer',
      'Sequence',
      'ParentEventId',
      'SchemaVersion',
      'ReasoningTokens',
      'EstimatedCostUsd',
      'ContentDroppedBytes',
      'LinesAdded',
      'agentops.event.sequence',
      'agentops.parent_event_id'
    ])
      && fileIncludes('packages/agentops-copilot-sdk/src/session-events.js', [
      'assistant.usage',
      'subagent.started',
      'skill.invoked',
      'mcpServerName',
      'ContentAction',
      'session.on(handler)'
    ])
      && fileIncludes('packages/agentops-copilot-sdk/src/createAgentOpsCopilotClient.js', [
        'onEvent',
        'captureContent must remain false',
        'resumeAgentOpsSession',
        'flushAgentOpsTelemetry'
      ])
      && fileIncludes('packages/agentops-copilot-sdk/src/otlp-exporter.js', [
        '/v1/traces',
        'otelAttributeMap',
        'requires HTTPS or a loopback HTTP endpoint'
      ])
      && fileIncludes('packages/agentops-copilot-sdk/src/hooks.js', [
        'onErrorOccurred',
        'onPostToolUseFailure'
      ])
      && fileIncludes('docs/copilot-sdk-adapter.md', [
        'early `onEvent`',
        '`captureContent=true` is rejected',
        '`CopilotCost`'
      ]);
  checks.push(check(
    'copilot-sdk-ordered-events-contract',
    sdkOrderedEventsOk,
    [
      'packages/agentops-copilot-sdk/src/session-events.js',
      'packages/agentops-copilot-sdk/src/event-envelope.js',
      'packages/agentops-copilot-sdk/src/createAgentOpsCopilotClient.js',
      'packages/agentops-copilot-sdk/src/otlp-exporter.js',
      'packages/agentops-copilot-sdk/src/hooks.js',
      'docs/copilot-sdk-adapter.md'
    ],
    sdkOrderedEventsOk ? [] : ['ordered SDK event/privacy contract is incomplete']
  ));

  checks.push(requiredFilesCheck('mcp-observability-proxy', [
    'agentops-cli/src/commands/mcp-proxy.js',
    'agentops-cli/src/lib/mcp-proxy-command.js',
    'agentops-cli/src/lib/mcp/proxy-stdio.js',
    'agentops-cli/src/lib/mcp/proxy-http.js',
    'agentops-cli/src/lib/mcp/risk-classifier.js',
    'agentops-cli/src/lib/mcp/redactor.js',
    'agentops-cli/src/lib/mcp/trace-context.js',
    'docs/mcp-observability-proxy.md',
    'examples/mcp-proxy/demo-server.js'
  ]));

  checks.push(requiredFilesCheck('github-outcomes', [
    'agentops-cli/src/commands/github-enrich.js',
    'agentops-cli/src/lib/github-enrich-command.js',
    'agentops-cli/src/lib/github/outcome-enricher.js',
    'agentops-cli/src/lib/github/pr-mapper.js',
    'agentops-cli/src/lib/github/actions-mapper.js',
    'agentops-cli/src/lib/github/revert-detector.js',
    'docs/github-outcome-enrichment.md'
  ]));

  checks.push(requiredFilesCheck('evals-insights-recommendations', [
    'agentops-cli/src/commands/explain.js',
    'agentops-cli/src/commands/insights.js',
    'agentops-cli/src/commands/recommend.js',
    'agentops-cli/src/commands/triage.js',
    'agentops-cli/src/lib/explain-command.js',
    'agentops-cli/src/lib/insights-command.js',
    'agentops-cli/src/lib/recommend-command.js',
    'agentops-cli/src/lib/triage-command.js',
    'agentops-cli/src/lib/schema/recommendation-schema.js',
    'agentops-cli/src/lib/evals/test-discipline.js',
    'agentops-cli/src/lib/evals/tool-efficiency.js',
    'agentops-cli/src/lib/evals/security.js',
    'agentops-cli/src/lib/evals/reliability.js',
    'agentops-cli/src/lib/evals/code-outcome.js',
    'agentops-cli/src/lib/insights/outlier-detector.js',
    'agentops-cli/src/lib/insights/regression-detector.js',
    'docs/evals-and-insights.md'
  ]));

  checks.push(requiredFilesCheck('grafana-v2-pack', [
    'grafana/dashboards/v2/01-agentops-home.json',
    'grafana/dashboards/v2/02-runs-explorer.json',
    'grafana/dashboards/v2/03-run-replay.json',
    'grafana/dashboards/v2/04-models-cost-tokens.json',
    'grafana/dashboards/v2/05-tools-mcp-risk.json',
    'grafana/dashboards/v2/06-safety-privacy-policy.json',
    'grafana/dashboards/v2/07-code-outcomes.json',
    'grafana/dashboards/v2/08-evals-quality.json',
    'grafana/dashboards/v2/09-insights-regressions.json',
    'grafana/dashboards/v2/10-collector-health.json',
    'grafana/provisioning/dashboards/agentops-v2.yaml',
    'grafana/provisioning/datasources/azure-monitor.yaml',
    'docs/grafana-ux-spec.md',
    'docs/grafana-dashboard-tour-v2.md',
    'docs/grafana-query-library.md'
  ]));

  checks.push(requiredFilesCheck('kql-library', [
    'grafana/kql/run-summary.kql',
    'grafana/kql/runs-explorer.kql',
    'grafana/kql/run-replay.kql',
    'grafana/kql/tool-risk.kql',
    'grafana/kql/privacy-signals.kql',
    'grafana/kql/code-outcomes.kql',
    'grafana/kql/evals.kql',
    'grafana/kql/insights.kql',
    'grafana/kql/collector-health.kql',
    'grafana/kql/content-viewer.kql'
  ]));

  const dashboard = validateDashboards();
  checks.push(check('dashboard-json-contract', dashboard.ok, [`${dashboard.dashboards} dashboard files parsed`], dashboard.errors));
  const links = validateDashboardLinks();
  checks.push(check('dashboard-drilldowns', links.ok, [`${links.checked_links} nav/data links checked`], links.errors));
  const ux = validateDashboardUx();
  checks.push(check('dashboard-operator-ux', ux.ok, ['Home, Runs, Replay, transcript, patterns, recommendations, and empty states checked'], ux.errors));
  checks.push(check(
    'run-centric-ui-contract',
    ux.ok
      && ux.contracts?.run_centric_ui === true
      && fileIncludes('docs/agentops-architecture-product-audit.md', [
        'Run-Centric UI',
        'Session explorer as first screen',
        'Trace waterfall through Run Story',
        'Ask AgentOps panel'
      ]),
    [
      'grafana/dashboards/v2/01-agentops-home.json',
      'grafana/dashboards/v2/02-runs-explorer.json',
      'grafana/dashboards/v2/03-run-replay.json',
      'docs/agentops-architecture-product-audit.md'
    ],
    ux.errors
  ));

  checks.push(check(
    'robust-eval-center-contract',
    ux.ok
      && ux.contracts?.robust_eval_center === true
      && fileIncludes('agentops-cli/src/lib/benchmark-validation.js', [
        'hiddenCheckPacks',
        'benchmarkPermissionProfiles',
        'macos-network-blocked',
        'container-network-blocked',
        'commandFileSeal',
        'semanticChecks',
        'llm-judge'
      ])
      && fileIncludes('agentops-cli/src/lib/benchmark-execution.js', [
        'commandFileSeal',
        'artifactDiff',
        'runBenchmarkSemanticChecks'
      ])
      && fileIncludes('agentops-cli/src/lib/benchmark-invocation.js', [
        '--network',
        'none',
        'benchmarkSandboxProfile',
        'benchmarkCopilotInvocation'
      ])
      && fileIncludes('agentops-cli/src/lib/benchmark-report.js', [
        'promotionApproval'
      ])
      && fileIncludes('grafana/dashboards/v2/08-evals-quality.json', [
        'BenchmarkArtifactContentDiffs',
        'BenchmarkApproval'
      ])
      && fileIncludes('docs/agentops-architecture-product-audit.md', [
        'Robust Eval Center',
        'Hidden check packs',
        'Rubric and semantic scoring',
        'Artifact diffing',
        'Promotion policy',
        'Container runtime network isolation'
      ]),
    [
      'agentops-cli/src/lib/benchmark-report.js',
      'agentops-cli/src/lib/benchmark-validation.js',
      'agentops-cli/src/lib/benchmark-execution.js',
      'agentops-cli/src/lib/benchmark-invocation.js',
      'grafana/dashboards/v2/08-evals-quality.json',
      'docs/agentops-architecture-product-audit.md'
    ],
    ux.errors
  ));

  checks.push(check(
    'hosted-llm-judge-deployment',
    fileIncludes('benchmark-judges/hosted-judge/server.js', ['metadata-only-hosted-llm-judge', 'POST', '/score', 'OPENAI_API_KEY', 'AGENTOPS_JUDGE_TOKEN'])
      && fileIncludes('benchmark-judges/hosted-judge/Dockerfile', ['node:22-alpine', 'server.js'])
      && fileIncludes('infra/bicep/hosted-judge.bicep', ['Microsoft.App/containerApps', 'judge-token', 'openai-api-key', 'judgeEndpoint'])
      && fileIncludes('agentops-cli/src/lib/benchmark-judge-guide.js', ['serviceArtifact', 'benchmark-judges/hosted-judge', 'infra/bicep/hosted-judge.bicep'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['deployable Azure Container Apps hosted judge', 'hosted-llm-judge-deployment']),
    [
      'benchmark-judges/hosted-judge/server.js',
      'benchmark-judges/hosted-judge/Dockerfile',
      'infra/bicep/hosted-judge.bicep',
      'agentops-cli/src/lib/benchmark-judge-guide.js',
      'docs/agentops-architecture-product-audit.md'
    ],
    []
  ));

  checks.push(check(
    'managed-benchmark-runner-image',
    fileIncludes('benchmark-runners/copilot-sandbox/Dockerfile', [
      'node:22-bookworm-slim',
      'AGENTOPS_BENCHMARK_RUNNER=managed-container-sandbox',
      'agentops-benchmark-entrypoint'
    ])
      && fileIncludes('benchmark-runners/copilot-sandbox/docker-entrypoint.sh', [
        'COPILOT_HOME',
        'command -v',
        'private derived image'
      ])
      && fileIncludes('benchmark-runners/copilot-sandbox/README.md', [
        'container-network-blocked',
        '--network none',
        'private registry'
      ])
      && fileIncludes('docs/agentops-architecture-product-audit.md', [
        'managed benchmark runner base image',
        'managed-benchmark-runner-image'
      ]),
    [
      'benchmark-runners/copilot-sandbox/Dockerfile',
      'benchmark-runners/copilot-sandbox/docker-entrypoint.sh',
      'benchmark-runners/copilot-sandbox/README.md',
      'docs/agentops-architecture-product-audit.md'
    ],
    []
  ));

  checks.push(check(
    'azure-ingest-privacy-plan',
    fileIncludes('agentops-cli/src/lib/azure/v2-ingest-plan.js', ['--allow-content', 'AgentOpsContent_CL', 'schema_versioning', 'schema_migration_policy', 'logs-ingestion-upload-plan'])
      && fileIncludes('agentops-cli/src/lib/azure-ingest-command.js', ['logs-upload', '--yes'])
      && fileIncludes('agentops-cli/src/lib/azure/logs-ingestion-upload.js', ['az', 'rest'])
      && fileIncludes('infra/bicep/v2-ingestion.bicep', ['AgentOpsRunSummary_CL', 'dataCollectionRules', 'streamDeclarations', 'logsIngestionEndpoint'])
      && fileIncludes('infra/bicep/main.bicep', ['deployV2Ingestion', 'AGENTOPS_LOGS_INGESTION_ENDPOINT', 'AGENTOPS_DCR_IMMUTABLE_ID'])
      && fileIncludes('docs/azure-v2-ingestion.md', ['AgentOpsContent_CL', '--allow-content', 'SchemaVersion', 'schema migration policy', 'azure-ingest logs-upload']),
    ['agentops-cli/src/lib/azure/v2-ingest-plan.js', 'agentops-cli/src/commands/azure-ingest.js', 'agentops-cli/src/lib/azure-ingest-command.js', 'agentops-cli/src/lib/azure/logs-ingestion-upload.js', 'infra/bicep/v2-ingestion.bicep', 'infra/bicep/main.bicep', 'docs/azure-v2-ingestion.md'],
    []
  ));

  checks.push(check(
    'content-transcript-opt-in',
    fileIncludes('docs/grafana-ux-spec.md', ['AgentOpsContent_CL', 'opt-in'])
      && fileIncludes('README.md', ['agentops content status', 'AgentOpsContent_CL'])
      && fileIncludes('grafana/kql/content-viewer.kql', ['AgentOpsContent_CL', 'MessageText']),
    ['docs/grafana-ux-spec.md', 'README.md', 'grafana/kql/content-viewer.kql'],
    []
  ));

  checks.push(check(
    'first-run-loop',
    fileIncludes('README.md', ['agentops init --full --yes', 'agentops copilot', 'agentops open latest'])
      && fileIncludes('docs/release-checklist-v2.md', ['init --dry-run --provision-cloud', 'smoke --real-copilot'])
      && fileIncludes('agentops-cli/src/lib/setup-init.js', ['Everyday observed use: agentops copilot', 'Cloud provision failed at:']),
    ['README.md', 'docs/release-checklist-v2.md', 'agentops-cli/src/lib/setup-init.js'],
    []
  ));

  checks.push(check(
    'ask-agentops-response-flow',
    fileIncludes('actioner/index.js', ['metadata-only-assistant-response', 'root_cause_candidates', 'rollback_condition', 'change_target_refs', 'expected_metric_movement', 'buildRecommendationReview', 'OperatorReview'])
      && fileIncludes('actioner/README.md', ['first-party metadata-only response draft', 'ChangeTargetRefs', 'ExpectedMetricMovement', 'BeforeTelemetry', 'OperatorReview'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['first-party metadata-only response draft', 'ExpectedMetricMovement', 'OperatorReview']),
    ['actioner/index.js', 'actioner/README.md', 'docs/agentops-architecture-product-audit.md'],
    []
  ));

  checks.push(check(
    'ask-agentops-live-response-flow',
    fileIncludes('actioner/index.js', ['metadata-only-live-assistant-request', 'AGENTOPS_ASSISTANT_API_URL', 'live-assistant-run', 'fetch(liveBox.dataset.apiUrl'])
      && fileIncludes('actioner/README.md', ['AGENTOPS_ASSISTANT_API_URL', 'inline live assistant form', 'metadata-only prompt and compact context'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['browser-native metadata-only live assistant response flow', 'AGENTOPS_ASSISTANT_API_URL']),
    ['actioner/index.js', 'actioner/README.md', 'docs/agentops-architecture-product-audit.md'],
    []
  ));

  checks.push(check(
    'ask-agentops-shared-context',
    fileIncludes('actioner/index.js', ['savedViewEvidenceFromPayload', 'alertHandoffEvidenceFromPayload', 'hydrateAskAgentOpsPayload', 'shared_context', 'recommendationBlob', 'savedViewBlob', 'alertHandoffBlob'])
      && fileIncludes('actioner/AskAgentOpsShared/function.json', ['ask-agentops/shared', 'recommendation_blob_id', 'saved_view_blob_id', 'alert_handoff_blob_id'])
      && fileIncludes('actioner/AskAgentOpsSharedRecommendation/function.json', ['ask-agentops/shared/recommendation/{recommendation_blob_id}', 'recommendationBlob'])
      && fileIncludes('actioner/AskAgentOpsSharedSavedView/function.json', ['ask-agentops/shared/saved-view/{saved_view_blob_id}', 'savedViewBlob'])
      && fileIncludes('actioner/AskAgentOpsSharedAlertHandoff/function.json', ['ask-agentops/shared/alert-handoff/{alert_handoff_blob_id}', 'alertHandoffBlob'])
      && fileIncludes('grafana/dashboards/v2/01-agentops-home.json', ['AskAgentOpsSharedLaunch', '/ask-agentops/shared/saved-view/', '/ask-agentops/shared/recommendation/'])
      && fileIncludes('grafana/dashboards/v2/03-run-replay.json', ['AskAgentOpsSharedLaunch', '/ask-agentops/shared/recommendation/'])
      && fileIncludes('grafana/dashboards/v2/06-safety-privacy-policy.json', ['AgentOpsAlertHandoffs_CL', 'AskAgentOpsSharedLaunch', '/ask-agentops/shared/alert-handoff/'])
      && fileIncludes('grafana/dashboards/v2/09-insights-regressions.json', ['AskAgentOpsSharedLaunch', '/ask-agentops/shared/recommendation/'])
      && fileIncludes('actioner/README.md', ['saved_view', 'alert_handoff', '/api/ask-agentops/shared', 'Dashboard action cells use the GET routes'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['shared-storage hydrated recommendation', 'actioner/AskAgentOpsShared', 'shared Ask AgentOps action cells', 'alert handoff review rows']),
    ['actioner/index.js', 'actioner/AskAgentOpsShared/function.json', 'actioner/AskAgentOpsSharedRecommendation/function.json', 'actioner/AskAgentOpsSharedSavedView/function.json', 'actioner/AskAgentOpsSharedAlertHandoff/function.json', 'grafana/dashboards/v2/01-agentops-home.json', 'grafana/dashboards/v2/03-run-replay.json', 'grafana/dashboards/v2/06-safety-privacy-policy.json', 'grafana/dashboards/v2/09-insights-regressions.json', 'actioner/README.md', 'docs/agentops-architecture-product-audit.md'],
    []
  ));

  checks.push(check(
    'recommendation-metric-movement',
    fileIncludes('agentops-cli/src/lib/recommendation-store.js', ['compareRecommendationAfterRun', 'AfterTelemetry', 'ObservedMetricMovement'])
      && fileIncludes('docs/evals-and-insights.md', ['agentops recommend compare'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['AfterTelemetry']),
    ['agentops-cli/src/lib/recommendation-store.js', 'docs/evals-and-insights.md', 'docs/agentops-architecture-product-audit.md'],
    []
  ));

  checks.push(check(
    'recommendation-action-plan',
    fileIncludes('agentops-cli/src/lib/recommendation-store.js', ['recommendationActionPlan', 'OperatorReview', 'benchmark_dry_run', 'compare_after_run'])
      && fileIncludes('actioner/index.js', ['action_plan_command', 'agentops recommend action-plan'])
      && fileIncludes('docs/evals-and-insights.md', ['agentops recommend action-plan'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['agentops recommend action-plan']),
    ['agentops-cli/src/lib/recommendation-store.js', 'actioner/index.js', 'docs/evals-and-insights.md', 'docs/agentops-architecture-product-audit.md'],
    []
  ));

  checks.push(check(
    'agent-improvement-guarded-apply',
    fileIncludes('actioner/index.js', ['buildGuardedRecommendationApply', 'metadata-only-guarded-apply', 'after-run metric movement', 'patch_handoff'])
      && fileIncludes('actioner/README.md', ['guarded apply packet', 'after-run metric movement', 'patch handoff'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['guarded apply packet', 'metadata-only-guarded-apply']),
    ['actioner/index.js', 'actioner/README.md', 'docs/agentops-architecture-product-audit.md'],
    []
  ));

  let liveDashboard = null;
  let liveAzure = null;
  if (live) {
    const dashboardArgs = ['--live', '--last', last];
    if (requireRows) dashboardArgs.push('--require-rows');
    liveDashboard = runDashboardVerify(dashboardArgs, options.dashboardOptions || {});
    liveAzure = runValidateAzure({ last, importDashboards: false });
    checks.push(check(
      'live-grafana-dashboard-queries',
      liveDashboard.ok,
      [
        `${liveDashboard.summary?.kql_checks || 0} live KQL checks`,
        `${liveDashboard.summary?.checked_links || 0} dashboard links checked`
      ],
      liveDashboard.errors || []
    ));
    checks.push(check(
      'live-azure-resources',
      liveAzure.ok,
      (liveAzure.checks || []).filter(item => item.ok).map(item => item.name),
      (liveAzure.checks || []).filter(item => !item.ok).map(item => item.name)
    ));
  }

  const failed = checks.filter(item => !item.ok);
  return {
    ok: failed.length === 0,
    scope: live ? 'local-and-live-product-contract' : 'local-product-contract',
    live_azure_verified: Boolean(liveAzure?.ok),
    live_grafana_verified: Boolean(liveDashboard?.ok),
    visual_grafana_verified: false,
    summary: {
      checks: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      v2_dashboards: links.dashboards || 0,
      checked_links: links.checked_links || 0,
      live_kql_checks: liveDashboard?.summary?.kql_checks || 0
    },
    checks,
    next: failed.length === 0
      ? (live
          ? [
              'agentops smoke --real-copilot --wait 2m --poll 10s --json',
              'agentops schema validate --json',
              'agentops validate-enterprise --json',
              'agentops collector smoke --privacy strict --poison --json',
              'npm --prefix packages/agentops-copilot-sdk test',
              'agentops e2e browser-check --report .agentops/e2e/latest/report.html --playwright --grafana --grafana-v2-only --require-grafana-visible --json',
              'npm --prefix agentops-cli test'
            ]
          : [
              'agentops demo verify --runs 50 --json',
              `agentops product audit --live --last ${last}${requireRows ? ' --require-rows' : ''} --json`,
              'agentops validate-azure --import-dashboards --last 24h --json',
              'agentops smoke --real-copilot --wait 2m --poll 10s --json'
            ])
      : [
          'agentops product audit --json',
          'agentops dashboard verify',
          'npm --prefix agentops-cli test'
        ]
  };
}

module.exports = { productAudit };
