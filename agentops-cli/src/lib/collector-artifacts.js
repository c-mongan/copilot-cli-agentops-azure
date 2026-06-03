const fs = require('node:fs');
const path = require('node:path');

const { collectorDir, repoRoot } = require('./paths');
const { contentLikeKeys, sanitizeAttributesStrict } = require('./privacy');

const requiredProcessors = [
  'strict-allowlist.yaml',
  'content-signal.yaml',
  'genai-normalizer.yaml',
  'mcp-normalizer.yaml',
  'span-to-run-summary.yaml'
];

const requiredFixtures = ['content-poison.json', 'mcp-poison.json'];
const requiredOwaspFixtures = [
  'broad-tool-permissions.json',
  'injected-tool-instructions.json',
  'mcp-dangerous-tool-classes.json',
  'mcp-prompt-injection.json',
  'prompt-injection.json',
  'runaway-tool-loop.json',
  'secret-tool-result.json'
];
const requiredMcpAbuseRisks = ['network', 'shell', 'destructive', 'secret-access'];
const strictConfigs = ['otelcol.azuremonitor.strict.yaml', 'otelcol.binary.strict.yaml', 'otelcol.local.strict.yaml'];

function validateProcessorFragment({ file, body }) {
  if (file === 'strict-allowlist.yaml' && !body.includes('keep_keys')) return `${file}: missing keep_keys allowlist`;
  if (file === 'content-signal.yaml' && !body.includes('agentops.content_capture.signal')) return `${file}: missing content capture signal`;
  if (file === 'genai-normalizer.yaml' && !body.includes('gen_ai.operation.name')) return `${file}: missing GenAI operation mapping`;
  if (file === 'mcp-normalizer.yaml' && !body.includes('mcp.method.name')) return `${file}: missing MCP method mapping`;
  if (file === 'span-to-run-summary.yaml' && !body.includes('AgentOpsRunSummary_CL')) return `${file}: missing run summary table contract`;
  return null;
}

function validatePoisonFixture({ file, fullPath }) {
  let fixture;
  try {
    fixture = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    return {
      file,
      ok: false,
      leaked: [],
      content_signal: false,
      error: `${file}: invalid JSON: ${error.message}`
    };
  }

  const sanitized = sanitizeAttributesStrict(fixture);
  const serialized = JSON.stringify(sanitized);
  const leaked = serialized.match(/SECRET_[A-Z_]+|api_key=|cat ~\/\.ssh\/id_rsa|this should never leave local machine/g) || [];
  const observedContent = Object.keys(fixture).some(key => (
    contentLikeKeys.includes(key) || /argument|result|message|prompt|secret|token|url/i.test(key)
  ));
  const contentSignal = sanitized['agentops.content_capture.signal'] === true;

  return {
    file,
    ok: leaked.length === 0 && (!observedContent || contentSignal),
    leaked,
    content_signal: contentSignal,
    error: null
  };
}

function mcpAbuseRisksFromFixture(fixture) {
  return new Set((Array.isArray(fixture?.['agentops.mcp.abuse_tools']) ? fixture['agentops.mcp.abuse_tools'] : [])
    .map(tool => String(tool?.risk || '').trim())
    .filter(Boolean));
}

function validateCollectorArtifacts(options = {}) {
  const root = options.root || repoRoot;
  const collectorRoot = path.join(root, 'collector');
  const processorsDir = path.join(collectorRoot, 'processors');
  const fixturesDir = path.join(collectorRoot, 'tests', 'privacy-poison-fixtures');
  const errors = [];
  const warnings = [];

  for (const file of requiredProcessors) {
    const fullPath = path.join(processorsDir, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`missing collector processor fragment: ${fullPath}`);
      continue;
    }

    const fragmentError = validateProcessorFragment({ file, body: fs.readFileSync(fullPath, 'utf8') });
    if (fragmentError) errors.push(fragmentError);
  }

  const fixtureResults = [];
  for (const file of requiredFixtures) {
    const fullPath = path.join(fixturesDir, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`missing poison fixture: ${fullPath}`);
      continue;
    }

    const result = validatePoisonFixture({ file, fullPath });
    if (result.error) errors.push(result.error);
    if (!result.ok && !result.error) errors.push(`${file}: strict sanitizer did not drop all poison content`);
    fixtureResults.push({
      file: result.file,
      ok: result.ok,
      leaked: result.leaked,
      content_signal: result.content_signal
    });
  }

  for (const file of strictConfigs) {
    const fullPath = path.join(collectorRoot, file);
    if (!fs.existsSync(fullPath)) errors.push(`missing strict collector config: ${fullPath}`);
    else if (!fs.readFileSync(fullPath, 'utf8').includes('transform/privacy_strict')) warnings.push(`${file}: does not reference transform/privacy_strict`);
  }

  return {
    ok: errors.length === 0,
    processors: requiredProcessors.map(file => path.join(processorsDir, file)),
    fixtures: fixtureResults,
    errors,
    warnings
  };
}

function validateOwaspFixtures(options = {}) {
  const root = options.root || repoRoot;
  const fixturesDir = path.join(root, 'collector', 'tests', 'owasp-abuse-fixtures');
  const errors = [];
  const results = [];

  for (const file of requiredOwaspFixtures) {
    const fullPath = path.join(fixturesDir, file);
    if (!fs.existsSync(fullPath)) {
      errors.push(`missing OWASP abuse fixture: ${fullPath}`);
      continue;
    }

    const result = validatePoisonFixture({ file, fullPath });
    if (result.error) errors.push(result.error);
    if (!result.ok && !result.error) errors.push(`${file}: strict sanitizer did not drop all abuse fixture content`);
    if (file === 'mcp-dangerous-tool-classes.json' && !result.error) {
      const fixture = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const risks = mcpAbuseRisksFromFixture(fixture);
      const missingRisks = requiredMcpAbuseRisks.filter(risk => !risks.has(risk));
      if (missingRisks.length > 0) errors.push(`${file}: missing MCP abuse risk classes: ${missingRisks.join(', ')}`);
    }
    results.push({
      file: result.file,
      ok: result.ok,
      leaked: result.leaked,
      content_signal: result.content_signal
    });
  }

  return {
    ok: errors.length === 0,
    fixtures: results,
    errors
  };
}

module.exports = {
  requiredFixtures,
  requiredMcpAbuseRisks,
  requiredOwaspFixtures,
  requiredProcessors,
  strictConfigs,
  validateCollectorArtifacts,
  validateOwaspFixtures,
  validatePoisonFixture,
  validateProcessorFragment
};
