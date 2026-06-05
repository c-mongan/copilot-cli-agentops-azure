const fs = require('node:fs');
const path = require('node:path');

const { hasFlag, optionValue } = require('../lib/args');
const { dashboardVerify, validateDashboardLinks, validateDashboardUx, validateDashboards } = require('./dashboard');
const { e2eBrowserCheck } = require('./e2e');
const { repoRoot } = require('../lib/paths');
const { validateWrapperContract } = require('../lib/copilot/wrapper-contract');
const legacy = require('../legacy');

const requiredVisualDashboards = [
  'agentops-v2-home',
  'agentops-v2-runs-explorer',
  'agentops-v2-run-replay',
  'agentops-v2-models-cost-tokens',
  'agentops-v2-tools-mcp-risk',
  'agentops-v2-safety-privacy-policy',
  'agentops-v2-code-outcomes',
  'agentops-v2-evals-quality',
  'agentops-v2-insights-regressions',
  'agentops-v2-collector-health'
];

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function fileIncludes(relativePath, terms) {
  if (!exists(relativePath)) return false;
  const body = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  return terms.every(term => body.includes(term));
}

function check(name, ok, evidence = [], missing = []) {
  return {
    name,
    ok: Boolean(ok),
    evidence,
    missing
  };
}

function requiredFilesCheck(name, files) {
  const missing = files.filter(file => !exists(file));
  return check(name, missing.length === 0, files.filter(file => !missing.includes(file)), missing);
}

function productAudit(options = {}) {
  const live = Boolean(options.live);
  const last = options.last || '24h';
  const requireRows = Boolean(options.requireRows);
  const runDashboardVerify = options.dashboardVerify || dashboardVerify;
  const runValidateAzure = options.validateAzure || legacy.validateAzure;
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
    'collector/tests/privacy-poison-fixtures/content-poison.json',
    'agentops-cli/src/commands/content.js',
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
    'agentops-cli/src/lib/copilot/resolve-real-copilot.js',
    'agentops-cli/src/lib/copilot/run-metadata.js',
    'agentops-cli/src/lib/copilot/flag-contract.js',
    'agentops-cli/src/lib/copilot/session-parser.js',
    'agentops-cli/src/lib/copilot/tool-classifier.js',
    'agentops-cli/src/lib/copilot/run-summary.js',
    'docs/copilot-cli-instrumentation.md',
    'docs/copilot-cli-flag-contract.md'
  ]));

  checks.push(requiredFilesCheck('copilot-sdk-adapter', [
    'packages/agentops-copilot-sdk/package.json',
    'packages/agentops-copilot-sdk/src/index.js',
    'packages/agentops-copilot-sdk/src/createAgentOpsCopilotClient.js',
    'packages/agentops-copilot-sdk/src/hooks.js',
    'packages/agentops-copilot-sdk/src/otel.js',
    'packages/agentops-copilot-sdk/src/privacy.js',
    'packages/agentops-copilot-sdk/test/adapter.test.js',
    'docs/copilot-sdk-adapter.md'
  ]));

  checks.push(requiredFilesCheck('mcp-observability-proxy', [
    'agentops-cli/src/commands/mcp-proxy.js',
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
    'azure-ingest-privacy-plan',
    fileIncludes('agentops-cli/src/lib/azure/v2-ingest-plan.js', ['--allow-content', 'AgentOpsContent_CL'])
      && fileIncludes('docs/azure-v2-ingestion.md', ['AgentOpsContent_CL', '--allow-content']),
    ['agentops-cli/src/lib/azure/v2-ingest-plan.js', 'docs/azure-v2-ingestion.md'],
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
    fileIncludes('README.md', ['agentops smoke --real-copilot', 'agentops open latest --last 2h'])
      && fileIncludes('docs/release-checklist-v2.md', ['init --dry-run --provision-cloud', 'smoke --real-copilot'])
      && fileIncludes('agentops-cli/src/legacy.js', ['First value: run the real smoke', 'Cloud provision failed at:']),
    ['README.md', 'docs/release-checklist-v2.md', 'agentops-cli/src/legacy.js'],
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
    'ask-agentops-shared-context',
    fileIncludes('actioner/index.js', ['savedViewEvidenceFromPayload', 'alertHandoffEvidenceFromPayload', 'saved_view', 'alert_handoff', 'SavedViewId', 'AlertHandoff'])
      && fileIncludes('actioner/README.md', ['saved_view', 'alert_handoff', 'saved-view query/tag/annotation context', 'alert handoff owner/query/config-change context'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['saved-view annotations', 'alert handoff config-change context', 'Hydrate the hosted Ask AgentOps workflow directly from shared storage']),
    ['actioner/index.js', 'actioner/README.md', 'docs/agentops-architecture-product-audit.md'],
    []
  ));

  checks.push(check(
    'recommendation-metric-movement',
    fileIncludes('agentops-cli/src/commands/recommend.js', ['compareRecommendationAfterRun', 'AfterTelemetry', 'ObservedMetricMovement'])
      && fileIncludes('docs/evals-and-insights.md', ['agentops recommend compare'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['AfterTelemetry']),
    ['agentops-cli/src/commands/recommend.js', 'docs/evals-and-insights.md', 'docs/agentops-architecture-product-audit.md'],
    []
  ));

  checks.push(check(
    'recommendation-action-plan',
    fileIncludes('agentops-cli/src/commands/recommend.js', ['recommendationActionPlan', 'OperatorReview', 'benchmark_dry_run', 'compare_after_run'])
      && fileIncludes('actioner/index.js', ['action_plan_command', 'agentops recommend action-plan'])
      && fileIncludes('docs/evals-and-insights.md', ['agentops recommend action-plan'])
      && fileIncludes('docs/agentops-architecture-product-audit.md', ['agentops recommend action-plan']),
    ['agentops-cli/src/commands/recommend.js', 'actioner/index.js', 'docs/evals-and-insights.md', 'docs/agentops-architecture-product-audit.md'],
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

function visualAuditRecoveryCommands(reportPath) {
  return [
    'agentops e2e run --live --browser-report --last 2h --json',
    `agentops e2e report --last 2h --out ${reportPath}`,
    `agentops product audit --live --last 2h --require-rows --require-visual --report ${reportPath} --json`
  ];
}

function validateVisualEvidence(evidencePath) {
  const resolved = path.resolve(evidencePath || '');
  if (!evidencePath || !fs.existsSync(resolved)) {
    return {
      ok: false,
      evidencePath: resolved,
      dashboards: [],
      visible: [],
      missing: [`Visual evidence file not found: ${resolved}`]
    };
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      evidencePath: resolved,
      dashboards: [],
      visible: [],
      missing: [`Visual evidence file is not valid JSON: ${error.message}`]
    };
  }

  const dashboards = Array.isArray(payload.dashboards) ? payload.dashboards : [];
  const byUid = new Map(dashboards.map(item => [String(item.uid || ''), item]));
  const missing = [];
  const visible = [];
  for (const uid of requiredVisualDashboards) {
    const item = byUid.get(uid);
    if (!item) {
      missing.push(`${uid}: missing`);
      continue;
    }
    const screenshotPath = item.screenshot ? path.resolve(path.dirname(resolved), item.screenshot) : '';
    const screenshotOk = screenshotPath && fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).size > 1000;
    if (item.authBlocked) missing.push(`${uid}: auth-blocked`);
    if (!item.dashboardVisible) missing.push(`${uid}: not visible`);
    if ((item.errors || []).length) missing.push(`${uid}: ${item.errors.join(', ')}`);
    if (!screenshotOk) missing.push(`${uid}: screenshot missing or too small`);
    if (!String(item.url || '').includes(`/d/${uid}`)) missing.push(`${uid}: URL does not match dashboard UID`);
    if (!item.authBlocked && item.dashboardVisible && !(item.errors || []).length && screenshotOk) visible.push(uid);
  }

  return {
    ok: missing.length === 0,
    evidencePath: resolved,
    dashboards,
    visible,
    missing
  };
}

async function productAuditWithVisual(options = {}) {
  const result = productAudit(options);
  if (!options.requireVisual) return result;

  if (options.visualEvidencePath) {
    const evidence = validateVisualEvidence(options.visualEvidencePath);
    const visualCheck = check(
      'visual-grafana-rendered-dashboards',
      evidence.ok,
      evidence.visible,
      evidence.missing
    );
    const checks = [...result.checks, visualCheck];
    const failed = checks.filter(item => !item.ok);
    return {
      ...result,
      ok: failed.length === 0,
      scope: options.live ? 'local-live-and-visual-product-contract' : 'local-and-visual-product-contract',
      visual_grafana_verified: evidence.ok,
      summary: {
        ...result.summary,
        checks: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
        visual_dashboards: evidence.dashboards.length,
        visual_dashboards_visible: evidence.visible.length
      },
      checks,
      visual: {
        ok: evidence.ok,
        evidencePath: evidence.evidencePath,
        status: 'evidence-file',
        dashboards: evidence.dashboards
      },
      next: evidence.ok
        ? result.next
        : [
            'Regenerate authenticated Grafana visual evidence from a signed-in browser.',
            ...visualAuditRecoveryCommands(options.reportPath || path.join(repoRoot, '.agentops', 'e2e', 'latest', 'report.html'))
          ]
    };
  }

  const runBrowserCheck = options.browserCheck || e2eBrowserCheck;
  const reportPath = options.reportPath || path.join(repoRoot, '.agentops', 'e2e', 'latest', 'report.html');
  const browserArgs = [
    '--report',
    reportPath,
    '--playwright',
    '--grafana',
    '--grafana-v2-only',
    '--require-grafana-visible'
  ];
  for (const [flag, value] of [
    ['--browser-executable', options.browserExecutable],
    ['--browser-user-data-dir', options.browserUserDataDir],
    ['--storage-state', options.storageState]
  ]) {
    if (value) browserArgs.push(flag, value);
  }
  if (options.headed) browserArgs.push('--headed');

  let visual;
  try {
    visual = await runBrowserCheck(browserArgs);
  } catch (error) {
    visual = { ok: false, error: error.message };
  }
  const grafanaItems = visual.playwright?.grafana || [];
  const authBlocked = grafanaItems.filter(item => item.authBlocked).map(item => item.label);
  const visible = grafanaItems.filter(item => item.dashboardVisible).map(item => item.label);
  const visualVerified = Boolean(visual.ok) && grafanaItems.length > 0 && visible.length === grafanaItems.length;
  const visualCheck = check(
    'visual-grafana-rendered-dashboards',
    visualVerified,
    visible,
    visualVerified ? [] : [
      visual.error || visual.playwright?.authRemediation?.reason || 'Grafana dashboards did not render in the browser profile',
      grafanaItems.length === 0 ? 'No Grafana dashboards were rendered by the visual browser check.' : '',
      ...authBlocked.map(label => `${label}: auth-blocked`)
    ].filter(Boolean)
  );

  const checks = [...result.checks, visualCheck];
  const failed = checks.filter(item => !item.ok);
  const recovery = visual.playwright?.authRemediation
    ? [
        ...(visual.playwright.authRemediation.sign_in_once || []),
        ...(visual.playwright.authRemediation.verify_after_sign_in || [])
      ]
    : visualAuditRecoveryCommands(reportPath);

  return {
    ...result,
    ok: failed.length === 0,
    scope: options.live ? 'local-live-and-visual-product-contract' : 'local-and-visual-product-contract',
    visual_grafana_verified: visualVerified,
    summary: {
      ...result.summary,
      checks: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      visual_dashboards: grafanaItems.length,
      visual_dashboards_visible: visible.length
    },
    checks,
    visual,
    next: visualVerified
      ? result.next
      : [
          ...recovery,
          'agentops product audit --live --last 2h --require-rows --require-visual --json'
        ]
  };
}

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

async function productCommand(args = []) {
  const [subcommand = 'audit'] = args;
  if (subcommand !== 'audit') throw new Error('product supports: audit');
  const result = await productAuditWithVisual({
    live: hasFlag(args, '--live'),
    requireRows: hasFlag(args, '--require-rows'),
    requireVisual: hasFlag(args, '--require-visual'),
    last: optionValue(args, '--last', '24h'),
    reportPath: optionValue(args, '--report', path.join(repoRoot, '.agentops', 'e2e', 'latest', 'report.html')),
    browserExecutable: optionValue(args, '--browser-executable', process.env.AGENTOPS_BROWSER_EXECUTABLE || ''),
    browserUserDataDir: optionValue(args, '--browser-user-data-dir', process.env.AGENTOPS_BROWSER_USER_DATA_DIR || ''),
    storageState: optionValue(args, '--storage-state', process.env.AGENTOPS_BROWSER_STORAGE_STATE || ''),
    visualEvidencePath: optionValue(args, '--visual-evidence', ''),
    headed: hasFlag(args, '--headed') || process.env.AGENTOPS_BROWSER_HEADED === '1'
  });
  process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(result, null, 2)}\n` : renderProductAudit(result));
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
