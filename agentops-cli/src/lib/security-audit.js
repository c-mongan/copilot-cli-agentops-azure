const fs = require('node:fs');
const path = require('node:path');

const { validateCollectorArtifacts, validateOwaspFixtures } = require('./collector-artifacts');
const { validateDashboardContentGuardrails } = require('./dashboard-content-guardrails');
const { poisonCheck } = require('./privacy');
const { collectorHome, repoRoot } = require('./paths');
const { readJson } = require('./json');
const { commandExists, run } = require('./shell');

function finding(name, ok, detail = null, severity = 'error', evidence = []) {
  return {
    name,
    ok: Boolean(ok),
    severity: ok && severity !== 'warning' ? 'info' : severity,
    detail,
    evidence
  };
}

function evidenceItem(file, note) {
  return { file, note };
}

function fileExists(root, file) {
  return fs.existsSync(path.join(root, file));
}

function isSourceCheckout(root) {
  return fs.existsSync(path.join(root, 'agentops-cli', 'package.json'));
}

function isInstalledPackage(root) {
  try {
    return readJson(path.join(root, 'package.json')).name === 'copilot-agentops-cli'
      && !isSourceCheckout(root);
  } catch {
    return false;
  }
}

function sourceEvidencePath(root, file) {
  if (file.startsWith('agentops-cli/') && !fileExists(root, file)) {
    const packageRelative = file.replace(/^agentops-cli\//, '');
    if (fileExists(root, packageRelative)) return packageRelative;
  }
  return file;
}

function evidenceStatus(root, evidence) {
  const missing = evidence
    .filter(item => item.file)
    .filter(item => !fileExists(root, sourceEvidencePath(root, item.file)))
    .map(item => sourceEvidencePath(root, item.file));
  return {
    ok: missing.length === 0,
    missing
  };
}

function fileIncludes(root, file, terms) {
  const absolute = path.join(root, sourceEvidencePath(root, file));
  if (!fs.existsSync(absolute)) return false;
  const body = fs.readFileSync(absolute, 'utf8').toLowerCase();
  return terms.every(term => body.includes(String(term).toLowerCase()));
}

const postureControls = [
  {
    id: 'LLM01',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'Prompt Injection',
    status: 'covered',
    summary: 'Prompt-like content is dropped in strict mode and prompt-injection abuse fixtures must sanitize before export.',
    evidence: [
      evidenceItem('collector/security-fixtures/owasp-abuse-fixtures/injected-tool-instructions.json', 'injected tool instruction fixture'),
      evidenceItem('collector/security-fixtures/owasp-abuse-fixtures/mcp-prompt-injection.json', 'MCP prompt injection fixture'),
      evidenceItem('collector/security-fixtures/owasp-abuse-fixtures/prompt-injection.json', 'prompt injection abuse fixture'),
      evidenceItem('collector/processors/content-signal.yaml', 'content-signal processor'),
      evidenceItem('agentops-cli/src/lib/privacy.js', 'strict sanitizer')
    ]
  },
  {
    id: 'LLM02',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'Sensitive Information Disclosure',
    status: 'covered',
    summary: 'Strict privacy mode drops content-like and secret-like fields; optional transcript capture requires explicit restricted-workspace, short-retention, RBAC-style guardrails.',
    evidence: [
      evidenceItem('collector/security-fixtures/privacy-poison-fixtures/content-poison.json', 'content poison fixture'),
      evidenceItem('collector/security-fixtures/owasp-abuse-fixtures/secret-tool-result.json', 'secret-like tool result fixture'),
      evidenceItem('agentops-cli/src/lib/dashboard-content-guardrails.js', 'dashboard content guardrail'),
      evidenceItem('docs/privacy-modes.md', 'content capture restricted workspace guidance'),
      evidenceItem('docs/azure-production-hardening.md', 'retention and RBAC production hardening')
    ]
  },
  {
    id: 'LLM03',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'Supply Chain',
    status: 'covered',
    summary: 'Runtime dependency audit, committed lockfiles, CI gates, and collector binary checksum tests cover current supply-chain posture.',
    evidence: [
      evidenceItem('agentops-cli/package-lock.json', 'CLI lockfile'),
      evidenceItem('packages/agentops-copilot-sdk/package-lock.json', 'SDK lockfile'),
      evidenceItem('.github/workflows/ci.yml', 'CI security gates'),
      evidenceItem('agentops-cli/src/lib/collector-manager.js', 'collector checksum verification')
    ]
  },
  {
    id: 'LLM04',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'Data And Model Poisoning',
    status: 'partial',
    summary: 'AgentOps is an observability product, not a training pipeline; current coverage is config/instruction hash evidence and regression detection.',
    evidence: [
      evidenceItem('agentops-cli/src/lib/insights/regression-detector.js', 'configuration and model regression detector'),
      evidenceItem('docs/evals-and-insights.md', 'eval and regression documentation')
    ]
  },
  {
    id: 'LLM05',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'Improper Output Handling',
    status: 'covered',
    summary: 'The product does not execute model output directly; SDK/MCP examples emit safe metadata and redact args/results.',
    evidence: [
      evidenceItem('agentops-cli/src/lib/mcp/redactor.js', 'MCP argument/result redaction'),
      evidenceItem('packages/agentops-copilot-sdk/src/privacy.js', 'SDK metadata privacy helpers'),
      evidenceItem('docs/mcp-observability-proxy.md', 'MCP proxy security boundary wording')
    ]
  },
  {
    id: 'LLM06',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'Excessive Agency',
    status: 'covered',
    summary: 'Tool risk, denied calls, broad-permission modes, MCP metadata, and abuse fixtures are tracked without capturing raw tool content.',
    evidence: [
      evidenceItem('collector/security-fixtures/owasp-abuse-fixtures/broad-tool-permissions.json', 'broad permission abuse fixture'),
      evidenceItem('agentops-cli/src/lib/mcp/risk-classifier.js', 'MCP and tool risk classifier'),
      evidenceItem('grafana/dashboards/v2/05-tools-mcp-risk.json', 'tool and MCP risk dashboard')
    ]
  },
  {
    id: 'LLM07',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'System Prompt Leakage',
    status: 'covered',
    summary: 'System instructions are treated as content-like fields and forbidden by strict schema/privacy checks.',
    evidence: [
      evidenceItem('agentops-cli/src/lib/schema/agent-run-schema.js', 'strict schema rejects content attributes'),
      evidenceItem('collector/processors/strict-allowlist.yaml', 'strict collector allowlist')
    ]
  },
  {
    id: 'LLM08',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'Vector And Embedding Weaknesses',
    status: 'not-applicable',
    summary: 'The current product has no vector store, retrieval memory, or embedding index surface.',
    evidence: [
      evidenceItem('docs/security-production-readiness-audit.md', 'documents vector-store non-applicability')
    ]
  },
  {
    id: 'LLM09',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'Misinformation',
    status: 'covered',
    summary: 'Dashboards are evidence aids with deterministic evals and code outcomes, and docs explicitly warn they are not correctness, compliance, or security guarantees.',
    evidence: [
      evidenceItem('agentops-cli/src/lib/evals/index.js', 'deterministic eval modules'),
      evidenceItem('docs/evals-and-insights.md', 'eval documentation'),
      evidenceItem('docs/security-production-readiness-audit.md', 'security caveats'),
      evidenceItem('docs/grafana-ux-spec.md', 'dashboard evidence disclaimer')
    ]
  },
  {
    id: 'LLM10',
    framework: 'OWASP LLM Top 10 2025',
    risk: 'Unbounded Consumption',
    status: 'covered',
    summary: 'Cost, token, latency, runaway loop, and Azure budget/alert posture are tested and surfaced in dashboards.',
    evidence: [
      evidenceItem('collector/security-fixtures/owasp-abuse-fixtures/runaway-tool-loop.json', 'runaway tool loop fixture'),
      evidenceItem('grafana/dashboards/v2/04-models-cost-tokens.json', 'model cost and token dashboard'),
      evidenceItem('docs/azure-production-hardening.md', 'budget and alert hardening')
    ]
  },
  {
    id: 'ASVS-SEC',
    framework: 'OWASP ASVS 5.0 aligned',
    risk: 'General Application Security Controls',
    status: 'covered',
    summary: 'Static analysis, dependency audit, secret scan, CI permissions, and release checklist cover the baseline app-security gate.',
    evidence: [
      evidenceItem('scripts/static-check.js', 'static analysis gate'),
      evidenceItem('.github/workflows/ci.yml', 'least-privilege CI and security gates'),
      evidenceItem('docs/release-checklist-v2.md', 'release checklist')
    ]
  }
];

function securityPosture(options = {}) {
  const root = options.root || repoRoot;
  const controls = postureControls.map(control => {
    const evidence = evidenceStatus(root, control.evidence);
    const status = evidence.ok ? control.status : 'gap';
    return {
      ...control,
      status,
      ok: evidence.ok && status !== 'gap',
      missing: evidence.missing
    };
  });
  const gaps = controls.filter(control => control.status === 'gap');
  const partial = controls.filter(control => control.status === 'partial');
  const notApplicable = controls.filter(control => control.status === 'not-applicable');
  const covered = controls.filter(control => control.status === 'covered');
  return {
    ok: gaps.length === 0,
    summary: {
      controls: controls.length,
      covered: covered.length,
      partial: partial.length,
      gaps: gaps.length,
      not_applicable: notApplicable.length
    },
    controls,
    next: gaps.length > 0
      ? 'Add the missing evidence or mark the control explicitly not-applicable with rationale.'
      : partial.length > 0
        ? 'Posture has partial controls; review them before regulated production use.'
        : 'Security posture is covered for the current product scope.'
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function runStaticCheck(options = {}) {
  const root = options.root || repoRoot;
  const script = path.join(root, 'scripts', 'static-check.js');
  if (isInstalledPackage(root) || (!fs.existsSync(script) && !isSourceCheckout(root))) {
    return finding('static-check', true, 'source-only static check is enforced by CI before packaging; installed package smoke validates runtime assets');
  }
  if (!fs.existsSync(script)) return finding('static-check', false, 'scripts/static-check.js is missing');
  const result = run(process.execPath, [script, '--json'], { cwd: root });
  const summary = parseJson(result.stdout);
  return finding(
    'static-check',
    result.status === 0 && summary?.ok === true,
    summary ? `${summary.checked.files} files checked` : (result.stderr || result.stdout || 'static check did not return JSON').trim(),
    'error',
    ['scripts/static-check.js']
  );
}

function runGitleaks(options = {}) {
  const root = options.root || repoRoot;
  if (!commandExists('gitleaks')) {
    return finding('secret-scan', false, 'gitleaks is not installed; install it or run an equivalent secret scan in CI', 'warning');
  }

  fs.mkdirSync(path.join(root, '.agentops'), { recursive: true });
  const result = run('gitleaks', [
    'detect',
    '--no-git',
    '--source',
    root,
    '--redact',
    '--report-format',
    'json',
    '--report-path',
    path.join(root, '.agentops', 'security-audit-gitleaks.json')
  ]);
  return finding(
    'secret-scan',
    result.status === 0,
    result.status === 0 ? 'gitleaks found no leaks' : (result.stderr || result.stdout || 'gitleaks reported findings').trim(),
    'error'
  );
}

function packageDirs(root) {
  return ['agentops-cli', 'packages/agentops-copilot-sdk']
    .map(dir => path.join(root, dir))
    .filter(dir => fs.existsSync(path.join(dir, 'package.json')));
}

function dependencyAudit(options = {}) {
  const root = options.root || repoRoot;
  const results = [];
  const warnings = [];
  const errors = [];

  for (const dir of packageDirs(root)) {
    const relative = path.relative(root, dir);
    const hasLockfile = ['package-lock.json', 'npm-shrinkwrap.json']
      .some(file => fs.existsSync(path.join(dir, file)));
    if (!hasLockfile) {
      warnings.push(`${relative}: missing npm lockfile; npm audit cannot prove dependency posture`);
      continue;
    }

    const result = run('npm', ['audit', '--omit=dev', '--json'], { cwd: dir });
    const parsed = parseJson(result.stdout);
    const critical = parsed?.metadata?.vulnerabilities?.critical || 0;
    const high = parsed?.metadata?.vulnerabilities?.high || 0;
    results.push({ package: relative, status: result.status, critical, high });
    if (result.status !== 0 && critical + high > 0) {
      errors.push(`${relative}: npm audit found ${critical} critical and ${high} high vulnerabilities`);
    }
  }

  return finding(
    'dependency-audit',
    errors.length === 0,
    errors.concat(warnings).join('; ') || 'npm audit found no high or critical runtime vulnerabilities',
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'info',
    results
  );
}

function ciGateCheck(options = {}) {
  const root = options.root || repoRoot;
  const workflow = path.join(root, '.github', 'workflows', 'ci.yml');
  if (isInstalledPackage(root) || (!fs.existsSync(workflow) && !isSourceCheckout(root))) {
    return finding('ci-security-gates', true, 'source-only CI gate evidence is checked before packaging; installed package includes runtime assets');
  }
  if (!fs.existsSync(workflow)) return finding('ci-security-gates', false, '.github/workflows/ci.yml is missing');
  const body = fs.readFileSync(workflow, 'utf8');
  const required = [
    'npm --prefix agentops-cli run static:check',
    'npm --prefix agentops-cli run coverage:check',
    'npm --prefix agentops-cli run publish:check',
    'npm --prefix packages/agentops-copilot-sdk run publish:check',
    'node scripts/check-release-distribution.js --json',
    'node scripts/check-install-smoke.js --json',
    'node scripts/check-homebrew-formula.js --json',
    'node agentops-cli/src/index.js security audit --json',
    'node agentops-cli/src/index.js security posture --json',
    'collector smoke --privacy strict --poison --json'
  ];
  const missing = required.filter(term => !body.includes(term));
  return finding(
    'ci-security-gates',
    missing.length === 0,
    missing.length === 0 ? 'CI runs static, coverage, and strict privacy smoke gates' : `missing CI gates: ${missing.join(', ')}`,
    'error',
    ['.github/workflows/ci.yml']
  );
}

function collectorPrivacyCheck(options = {}) {
  const result = validateCollectorArtifacts({ root: options.root || repoRoot });
  return finding(
    'collector-privacy-artifacts',
    result.ok,
    result.ok ? 'strict collector processors and poison fixtures validated' : result.errors.join('; '),
    'error',
    result.fixtures
  );
}

function poisonRuntimeCheck() {
  const result = poisonCheck();
  return finding(
    'strict-poison-sanitizer',
    result.ok,
    result.ok ? 'strict sanitizer drops poison content and keeps safe metadata' : `leaked: ${result.leaked.join(', ')}`,
    'error',
    [result.safe_fields_present]
  );
}

function owaspFixtureCheck(options = {}) {
  const result = validateOwaspFixtures({ root: options.root || repoRoot });
  return finding(
    'owasp-abuse-fixtures',
    result.ok,
    result.ok ? `${result.fixtures.length} OWASP abuse fixtures validated` : result.errors.join('; '),
    'error',
    result.fixtures
  );
}

function dashboardContentGuardrailCheck(options = {}) {
  const result = validateDashboardContentGuardrails({ root: options.root || repoRoot });
  return finding(
    'dashboard-content-guardrails',
    result.ok,
    result.ok
      ? 'V2 dashboards keep optional prompt/response rows isolated to explicit opt-in panels'
      : result.errors.join('; '),
    'error',
    result.allowed_content_panels
  );
}

function contentCaptureOperationalGuardrailsCheck(options = {}) {
  const root = options.root || repoRoot;
  const evidence = [
    {
      file: 'docs/privacy-modes.md',
      terms: ['restricted workspace', 'approved viewers', 'short retention']
    },
    {
      file: 'docs/azure-production-hardening.md',
      terms: ['Optional content capture', 'separate restricted workspace or table', 'short retention']
    },
    {
      file: 'docs/azure-v2-ingestion.md',
      terms: ['--allow-content', 'access-controlled workspace/dashboard']
    },
    {
      file: 'agentops-cli/src/lib/content-status.js',
      terms: ['restricted to approved viewers', 'AgentOpsContent_CL can contain sensitive text']
    }
  ];
  const missing = evidence.filter(item => !fileIncludes(root, item.file, item.terms));
  return finding(
    'content-capture-operational-guardrails',
    missing.length === 0,
    missing.length === 0
      ? 'optional content capture requires restricted workspace/viewers, short retention, and explicit --allow-content review'
      : `missing content-capture guardrail evidence: ${missing.map(item => item.file).join(', ')}`,
    'error',
    evidence.map(item => ({ file: sourceEvidencePath(root, item.file), terms: item.terms }))
  );
}

function dashboardEvidenceDisclaimerCheck(options = {}) {
  const root = options.root || repoRoot;
  const evidence = [
    {
      file: 'docs/grafana-ux-spec.md',
      terms: ['evidence aids', 'not correctness, compliance, or security guarantees']
    },
    {
      file: 'docs/evals-and-insights.md',
      terms: ['deterministic evals', 'not a substitute']
    },
    {
      file: 'docs/security-production-readiness-audit.md',
      terms: ['evidence aids', 'not correctness, compliance, or security guarantees']
    }
  ];
  const missing = evidence.filter(item => !fileIncludes(root, item.file, item.terms));
  return finding(
    'dashboard-evidence-disclaimer',
    missing.length === 0,
    missing.length === 0
      ? 'dashboards and evals are documented as investigation evidence, not correctness/compliance guarantees'
      : `missing dashboard/eval disclaimer evidence: ${missing.map(item => item.file).join(', ')}`,
    'error',
    evidence.map(item => ({ file: item.file, terms: item.terms }))
  );
}

const persistentQueueConfigs = [
  'collector/otelcol.azuremonitor.strict.yaml',
  'collector/otelcol.azuremonitor.compat.yaml',
  'collector/otelcol.binary.strict.yaml',
  'collector/otelcol.binary.compat.yaml'
];

function pipelineProcessors(body, signal) {
  const list = body.match(new RegExp(`^    ${signal}:\\s*\\n(?:^      .+\\n)*?^      processors:\\s*\\[([^\\]]*)\\]`, 'm'))?.[1] || '';
  return list.split(',').map(value => value.trim()).filter(Boolean);
}

function persistentCollectorQueueCheck(options = {}) {
  const root = options.root || repoRoot;
  const errors = [];
  const evidence = [];

  for (const file of persistentQueueConfigs) {
    const resolved = sourceEvidencePath(root, file);
    const absolute = path.join(root, resolved);
    if (!fs.existsSync(absolute)) {
      errors.push(`${resolved}: required persistent-queue config is missing`);
      continue;
    }
    const body = fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n');
    const fileStorage = body.match(/^  file_storage:\s*\n([\s\S]*?)(?=^processors:)/m)?.[1] || '';
    const azureExporter = body.match(/^  azuremonitor:\s*\n([\s\S]*?)(?=^service:)/m)?.[1] || '';
    const queue = azureExporter.match(/^    sending_queue:\s*\n((?:^      .+\n?)*)/m)?.[1] || '';
    const size = Number(queue.match(/^      queue_size:\s*(\d+)\s*$/m)?.[1]);
    const strict = file.includes('.strict.');

    if (!/directory:\s*\$\{env:AGENTOPS_OTEL_STORAGE_DIR\}/.test(fileStorage)) errors.push(`${resolved}: file_storage must use AGENTOPS_OTEL_STORAGE_DIR`);
    if (!/create_directory:\s*true/.test(fileStorage)) errors.push(`${resolved}: file_storage must create its configured directory`);
    if (!/^  extensions:\s*\[[^\]]*file_storage[^\]]*\]/m.test(body)) errors.push(`${resolved}: service must enable file_storage`);
    if (!/enabled:\s*true/.test(queue)) errors.push(`${resolved}: sending_queue must be enabled`);
    if (!/storage:\s*file_storage/.test(queue)) errors.push(`${resolved}: sending_queue must persist through file_storage`);
    if (!Number.isInteger(size) || size < 1 || size > 10000) errors.push(`${resolved}: sending_queue queue_size must be bounded between 1 and 10000`);

    if (strict) {
      for (const signal of ['traces', 'metrics', 'logs']) {
        const processors = pipelineProcessors(body, signal);
        const privacyIndex = processors.indexOf('transform/privacy_strict');
        const batchIndex = processors.indexOf('batch');
        if (privacyIndex < 0) errors.push(`${resolved}: ${signal} pipeline must include transform/privacy_strict before export`);
        if (batchIndex >= 0 && privacyIndex > batchIndex) errors.push(`${resolved}: ${signal} pipeline must sanitize before batch/queue/export`);
      }
    }
    evidence.push({ file: resolved, queue_size: size || null, strict });
  }

  const queueDir = options.collectorQueueDir || path.join(collectorHome, 'queue');
  let runtime = { directory: queueDir, exists: false, permissions_checked: false };
  if (fs.existsSync(queueDir)) {
    const mode = fs.statSync(queueDir).mode & 0o777;
    runtime = { directory: queueDir, exists: true, permissions_checked: process.platform !== 'win32', mode: mode.toString(8).padStart(3, '0') };
    if (process.platform !== 'win32' && (mode & 0o077) !== 0) errors.push(`${queueDir}: persistent queue directory permissions must not grant group/other access`);
  }
  evidence.push(runtime);

  return finding(
    'collector-persistent-queue-security',
    errors.length === 0,
    errors.length === 0
      ? `${persistentQueueConfigs.length} persistent queue configs are bounded, privacy-first, and runtime permissions are safe when present`
      : errors.join('; '),
    'error',
    evidence
  );
}

function localStrictCollectorSecurityCheck(options = {}) {
  const root = options.root || repoRoot;
  const file = sourceEvidencePath(root, 'collector/otelcol.local.strict.yaml');
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    return finding('collector-local-strict-security', false, `${file}: strict local Collector config is missing`, 'error', [{ file }]);
  }

  const body = fs.readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n');
  const errors = [];
  const requirePattern = (pattern, message) => {
    if (!pattern.test(body)) errors.push(message);
  };

  requirePattern(/directory:\s*\$\{env:AGENTOPS_OTEL_STORAGE_DIR\}/, `${file}: local durable storage must use AGENTOPS_OTEL_STORAGE_DIR`);
  requirePattern(/create_directory:\s*true/, `${file}: local durable storage must create its configured directory`);
  requirePattern(/fsync:\s*true/, `${file}: local durable storage must enable fsync`);
  requirePattern(/^  extensions:\s*\[[^\]]*file_storage[^\]]*\]/m, `${file}: local service must enable file_storage`);
  requirePattern(/^  otlp_http\/local_receipt:\s*\n[\s\S]*?sending_queue:\s*\n[\s\S]*?enabled:\s*true/m, `${file}: local receipt relay must have a durable sending queue`);
  requirePattern(/storage:\s*file_storage/, `${file}: local receipt relay must persist through file_storage`);
  requirePattern(/queue_size:\s*(?:[1-9]\d{0,3}|10000)\s*$/m, `${file}: local receipt queue must be bounded`);
  requirePattern(/error_mode:\s*propagate/, `${file}: strict privacy transforms must fail closed`);
  requirePattern(/endpoint:\s*127\.0\.0\.1:4319/, `${file}: local receipt relay must remain loopback-only`);

  for (const signal of ['traces', 'metrics', 'logs']) {
    const processors = pipelineProcessors(body, signal);
    const privacyIndex = processors.indexOf('transform/privacy_strict');
    const batchIndex = processors.indexOf('batch');
    if (privacyIndex < 0) errors.push(`${file}: ${signal} pipeline must include transform/privacy_strict`);
    if (batchIndex >= 0 && privacyIndex > batchIndex) errors.push(`${file}: ${signal} pipeline must sanitize before batch/queue/export`);
  }

  return finding(
    'collector-local-strict-security',
    errors.length === 0,
    errors.length === 0
      ? 'strict local Collector uses loopback receivers, fail-closed privacy filtering, and a bounded private receipt queue'
      : errors.join('; '),
    'error',
    [{ file, controls: ['loopback-receivers', 'strict-transform', 'fail-closed-transform', 'private-file-storage', 'bounded-receipt-queue'] }]
  );
}

function durableReceiptSecurityCheck(options = {}) {
  const root = options.root || repoRoot;
  const spoolFile = sourceEvidencePath(root, 'agentops-cli/src/lib/azure/durable-evidence-spool.js');
  const uploadFile = sourceEvidencePath(root, 'agentops-cli/src/lib/azure/logs-ingestion-upload.js');
  const subscriptionFile = sourceEvidencePath(root, 'agentops-cli/src/lib/azure/subscription-guard.js');
  const errors = [];
  const evidence = [];
  const read = file => {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`${file}: required durable receipt security evidence is missing`);
      return '';
    }
    return fs.readFileSync(absolute, 'utf8');
  };
  const spool = read(spoolFile);
  const upload = read(uploadFile);
  const subscription = read(subscriptionFile);
  const requirePattern = (body, pattern, message) => {
    if (!pattern.test(body)) errors.push(message);
  };

  requirePattern(spool, /const allowedEvidenceTables = new Set\(\[\s*'AgentOpsEvents_CL'\s*\]\)/,
    `${spoolFile}: durable receipts must target AgentOpsEvents_CL only`);
  requirePattern(spool, /row\.PrivacyMode = 'strict'[\s\S]*row\.ContentCaptureMode = 'off'/,
    `${spoolFile}: durable receipt canonicalizer must force strict privacy and content capture off`);
  requirePattern(spool, /const maximumMaxBytes = \d+[\s\S]*const maximumTtlMs = \d+[\s\S]*const maximumRetryDelayMs = \d+[\s\S]*const maximumDrainAttempts = \d+/,
    `${spoolFile}: bytes, TTL, retry delay, and attempt bounds must be explicit`);
  requirePattern(spool, /boundedOption\(drainOptions\.maxAttempts, 3, maximumDrainAttempts/,
    `${spoolFile}: drain attempts must use the bounded option validator`);
  requirePattern(spool, /lstatSync\(directory\)[\s\S]*isSymbolicLink\(\)[\s\S]*lstatSync\(file\)[\s\S]*isSymbolicLink\(\)/,
    `${spoolFile}: spool root and segments must reject symlinks`);
  requirePattern(spool, /mkdirSync\(directory, \{ recursive: true, mode: 0o700 \}\)[\s\S]*openSync\(temporary, 'wx', 0o600\)/,
    `${spoolFile}: spool directory and segments must be private`);
  requirePattern(spool, /immutableEnvelopeHash[\s\S]*created_at[\s\S]*expires_at[\s\S]*row_hash/,
    `${spoolFile}: immutable receipt envelope fields must be integrity checked`);
  if (/['"](?:Reason|Error)['"]/.test(spool)) {
    errors.push(`${spoolFile}: raw Reason/Error fields must never be allowlisted or persisted`);
  }

  requirePattern(upload, /new URL\([\s\S]*\.ingest\.monitor\.azure\.com[\s\S]*endpoint\.username[\s\S]*endpoint\.password[\s\S]*endpoint\.hash[\s\S]*endpoint\.search/,
    `${uploadFile}: uploader must validate the Azure public Monitor hostname and reject URL credential/query/fragment injection`);
  requirePattern(upload, /endpoint\.pathname !== '\/'/,
    `${uploadFile}: uploader must reject non-root endpoint paths`);
  requirePattern(upload, /\^dcr-\[A-Za-z0-9-\]\+\$/,
    `${uploadFile}: uploader must validate the DCR immutable ID`);
  requirePattern(upload, /maximumRequestTimeoutMs[\s\S]*requestTimeoutMs\(options\.timeoutMs\)[\s\S]*AbortSignal\.timeout\(timeoutMs\)/,
    `${uploadFile}: HTTP requests must use a bounded timeout`);
  requirePattern(upload, /checkAzureSubscription\([\s\S]*expectedSubscriptionId: options\.expectedSubscriptionId[\s\S]*subscriptionId: subscription\.expected/,
    `${uploadFile}: uploader and token request must use the exact guarded subscription`);
  requirePattern(subscription, /APPROVED_AZURE_SUBSCRIPTION_IDS[\s\S]*approved\.includes\(expected\)[\s\S]*refused the write/,
    `${subscriptionFile}: subscription guard must fail closed against the approved enterprise subscription`);

  evidence.push(
    { file: spoolFile, controls: ['events-only-schema', 'strict-off', 'private-spool', 'symlink-rejection', 'bounded-storage-ttl-retries', 'envelope-integrity', 'no-raw-reason-error'] },
    { file: uploadFile, controls: ['monitor-hostname', 'dcr-validation', 'exact-subscription', 'bounded-http-timeout-response'] },
    { file: subscriptionFile, controls: ['enterprise-subscription-allowlist', 'fail-closed-write-guard'] }
  );
  return finding(
    'durable-receipt-security',
    errors.length === 0,
    errors.length === 0
      ? 'durable AgentOpsEvents receipts are metadata-only, bounded, private, integrity-checked, and pinned to the guarded Azure Monitor destination'
      : errors.join('; '),
    'error',
    evidence
  );
}

function securityAudit(options = {}) {
  const runGitleaksCheck = options.runGitleaks || runGitleaks;
  const runStatic = options.runStaticCheck || runStaticCheck;
  const checks = [
    runStatic(options),
    runGitleaksCheck(options),
    dependencyAudit(options),
    ciGateCheck(options),
    collectorPrivacyCheck(options),
    poisonRuntimeCheck(options),
    owaspFixtureCheck(options),
    dashboardContentGuardrailCheck(options),
    contentCaptureOperationalGuardrailsCheck(options),
    dashboardEvidenceDisclaimerCheck(options),
    localStrictCollectorSecurityCheck(options),
    persistentCollectorQueueCheck(options),
    durableReceiptSecurityCheck(options)
  ];
  const blocking = checks.filter(check => !check.ok && check.severity === 'error');
  const warnings = checks.filter(check => check.severity === 'warning');
  return {
    ok: blocking.length === 0,
    summary: {
      checks: checks.length,
      passed: checks.filter(check => check.ok).length,
      warnings: warnings.length,
      blocking: blocking.length
    },
    checks,
    next: blocking.length > 0
      ? 'Fix blocking security audit failures before production use.'
      : warnings.length > 0
        ? 'Review warnings before production use.'
        : 'Security audit passed.'
  };
}

module.exports = {
  ciGateCheck,
  collectorPrivacyCheck,
  contentCaptureOperationalGuardrailsCheck,
  dependencyAudit,
  dashboardEvidenceDisclaimerCheck,
  dashboardContentGuardrailCheck,
  durableReceiptSecurityCheck,
  localStrictCollectorSecurityCheck,
  owaspFixtureCheck,
  poisonRuntimeCheck,
  persistentCollectorQueueCheck,
  runGitleaks,
  runStaticCheck,
  securityAudit,
  securityPosture
};
