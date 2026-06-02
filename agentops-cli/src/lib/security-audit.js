const fs = require('node:fs');
const path = require('node:path');

const { validateCollectorArtifacts, validateOwaspFixtures } = require('./collector-artifacts');
const { validateDashboardContentGuardrails } = require('./dashboard-content-guardrails');
const { poisonCheck } = require('./privacy');
const { repoRoot } = require('./paths');
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
  if (!fs.existsSync(workflow)) return finding('ci-security-gates', false, '.github/workflows/ci.yml is missing');
  const body = fs.readFileSync(workflow, 'utf8');
  const required = [
    'npm --prefix agentops-cli run static:check',
    'npm --prefix agentops-cli run coverage:check',
    'node agentops-cli/src/index.js security audit --json',
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
    dashboardContentGuardrailCheck(options)
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
  dependencyAudit,
  dashboardContentGuardrailCheck,
  owaspFixtureCheck,
  poisonRuntimeCheck,
  runGitleaks,
  runStaticCheck,
  securityAudit
};
