const path = require('node:path');
const fs = require('node:fs');

const { hasFlag, optionValue } = require('./args');
const { browserProfileOptionsFromArgs } = require('./browser-options');
const { writeJsonOrRender } = require('./command-output');
const { e2eBrowserCheck } = require('./e2e-browser-check');
const { repoRoot } = require('./paths');
const { productAudit } = require('./product-audit');
const { renderProductAudit } = require('./product-audit-render');
const { productAuditWithVisual: runProductAuditWithVisual } = require('./product-audit-visual');
const { validateVisualEvidence, visualAuditRecoveryCommands } = require('./product-visual');

async function productAuditWithVisual(options = {}) {
  return runProductAuditWithVisual(options, {
    productAudit,
    browserCheck: options.browserCheck || e2eBrowserCheck
  });
}

const PRODUCT_HELP = `agentops product <audit|build|evidence|compare|runtime>
  audit [--live] [--last <duration>] [--require-rows] [--require-visual] [--report <html>] [--json]
  build --ledger <dir> --repo <dir> --out <new-dir> [--experiments <dir>] [--evaluation <json>] [--evaluation-key <json> --evaluation-records <json> --evaluation-workspace <dir>] [--copilot-home <dir>] [--json]
  evidence --ledger <dir> [--repo <dir>] [--evaluation <json>] [--evaluation-key <json> --evaluation-records <json> --evaluation-workspace <dir>] [--out <new-dir>] [--json]
  compare --experiment <json> [--baseline-root <dir>] [--candidate-root <dir>] [--json]
  runtime [--json]
Build writes local Runs, Architecture, Compare and evidence receipts. Evidence previews by default.
Compare assesses stored trials; it never runs a model or approves a refactor.
Runtime reports local qualification only. Cloud delivery remains pending; no automatic uploads.
`;

const OPTIONS = {
  audit: { values: ['--last', '--report', '--visual-evidence', '--browser-executable', '--browser-user-data-dir', '--storage-state'], flags: ['--live', '--require-rows', '--require-visual', '--headed', '--azure-cli-grafana-auth'] },
  build: { values: ['--ledger', '--repo', '--out', '--experiments', '--evaluation', '--evaluation-key', '--evaluation-records', '--evaluation-workspace', '--copilot-home'], flags: [] },
  evidence: { values: ['--ledger', '--repo', '--evaluation', '--evaluation-key', '--evaluation-records', '--evaluation-workspace', '--out'], flags: [] },
  compare: { values: ['--experiment', '--baseline-root', '--candidate-root'], flags: [] },
  runtime: { values: [], flags: [] }
};

// Validate the entire request before reading a ledger, starting a browser, or writing outputs.
function parseProductArgs(args) {
  if (hasFlag(args, '--help') || hasFlag(args, '-h') || args[0] === 'help') return { help: true };
  const subcommand = args[0] && !args[0].startsWith('-') ? args[0] : 'audit';
  const spec = OPTIONS[subcommand];
  if (!spec) throw new Error('product supports: audit, build, evidence, compare, runtime');
  const options = {};
  for (let i = subcommand === args[0] ? 1 : 0; i < args.length; i += 1) {
    const arg = args[i];
    const equal = arg.indexOf('=');
    const name = equal < 0 ? arg : arg.slice(0, equal);
    if (['--json', ...spec.flags].includes(name) && equal < 0) { options[name] = true; continue; }
    if (!spec.values.includes(name)) throw new Error(`Unknown product ${subcommand} option: ${arg}`);
    const value = equal < 0 ? args[++i] : arg.slice(equal + 1);
    if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate product option: ${name}`);
    options[name] = value;
  }
  for (const required of subcommand === 'build' ? ['--ledger', '--repo', '--out'] : subcommand === 'evidence' ? ['--ledger'] : subcommand === 'compare' ? ['--experiment'] : []) {
    if (!options[required]) throw new Error(`product ${subcommand} requires ${required}`);
  }
  const verificationFlags = ['--evaluation-key', '--evaluation-records', '--evaluation-workspace'];
  if (verificationFlags.some(name => options[name]) && (!options['--evaluation'] || verificationFlags.some(name => !options[name]))) throw new Error('Evaluation replay requires --evaluation and all three --evaluation-key, --evaluation-records, --evaluation-workspace options');
  return { subcommand, options };
}

function readProductJson(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Product evidence must be a bounded regular JSON file');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object') throw new Error('Product evidence must be a JSON object or array');
  return value;
}

function renderProductResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

async function productCommand(args = [], dependencies = {}) {
  const parsed = parseProductArgs(args);
  const stdout = dependencies.stdout || process.stdout;
  if (parsed.help) { stdout.write(PRODUCT_HELP); return { ok: true, action: 'help' }; }
  const { subcommand, options } = parsed;
  let result;
  if (subcommand === 'audit') {
    result = await productAuditWithVisual({
      live: hasFlag(args, '--live'), requireRows: hasFlag(args, '--require-rows'), requireVisual: hasFlag(args, '--require-visual'),
      last: optionValue(args, '--last', '24h'),
      reportPath: optionValue(args, '--report', path.join(repoRoot, '.agentops', 'e2e', 'latest', 'report.html')),
      ...browserProfileOptionsFromArgs(args), visualEvidencePath: optionValue(args, '--visual-evidence', ''),
      ...(dependencies.browserCheck ? { browserCheck: dependencies.browserCheck } : {})
    });
    writeJsonOrRender(result, hasFlag(args, '--json'), renderProductAudit, stdout);
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (subcommand === 'compare') {
    const record = readProductJson(options['--experiment']);
    const { evaluateExperiment } = require('./architecture/experiment-contract');
    result = { action: 'compare', ...evaluateExperiment(record, { baselineRoot: options['--baseline-root'], candidateRoot: options['--candidate-root'] }), execution: 'stored-trials-only', cloudDelivery: 'pending' };
  } else if (subcommand === 'runtime') {
    const qualify = dependencies.runtimeQualification || require(path.join(repoRoot, 'scripts/check-runtime-matrix')).readRuntimeQualification;
    result = await qualify();
  } else {
    const { productEvidenceFromLedger, writeProductEvidenceBundle } = dependencies.evidenceApi || require('./product-evidence-bundle');
    const evidenceOptions = { ledgerDir: path.resolve(options['--ledger']), repoRoot: path.resolve(options['--repo'] || process.cwd()), evaluationFile: options['--evaluation'], evaluationVerifier: dependencies.evaluationVerifier,
      evaluationKeyFile: options['--evaluation-key'], evaluationRecordsFile: options['--evaluation-records'], evaluationWorkspaceRoot: options['--evaluation-workspace'] };
    // Receipt qualification happens before output generation.
    let bundle = productEvidenceFromLedger(evidenceOptions);
    if (subcommand === 'evidence') {
      result = options['--out'] ? { action: 'evidence', bundle, files: writeProductEvidenceBundle(bundle, path.resolve(options['--out'])), cloudDelivery: 'pending' } : { action: 'evidence', preview: true, bundle, cloudDelivery: 'pending' };
    } else {
      const outDir = path.resolve(options['--out']);
      if (fs.existsSync(outDir)) throw new Error('product build requires a new output directory; existing artifacts are preserved');
      const { architectureCommand } = dependencies.architectureApi || require('./architecture-command');
      const buildArgs = ['--ledger', evidenceOptions.ledgerDir, '--repo', evidenceOptions.repoRoot, '--out', outDir, '--json'];
      for (const name of ['--experiments', '--copilot-home']) if (options[name]) buildArgs.push(name, options[name]);
      const architecture = architectureCommand(buildArgs, { stdout: { write() {} } });
      bundle = productEvidenceFromLedger({ ...evidenceOptions, architectureRows: architecture.azure_rows });
      const evidence = writeProductEvidenceBundle(bundle, path.join(outDir, 'evidence'));
      const manifest = { action: 'build', localEvidence: 'generated', cloudDelivery: 'pending', views: { runs: 'runs.html', architecture: 'architecture.html', compare: 'compare.html' }, evidence, architectureVersion: architecture.architecture_version, outcomes: bundle.manifest.evaluationReceipts.some(receipt => receipt.state === 'locally-regraded') ? 'locally regraded receipts; see evidence tiers and per-run limits' : 'unknown: no verified evaluation receipt', automation: 'no model trials, uploads, or refactors executed' };
      const manifestPath = path.join(outDir, 'product.json');
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(path.join(outDir, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AgentOps local diagnostics</title><main><h1>AgentOps local diagnostics</h1><p>Local evidence generated. Cloud delivery pending.</p><nav><a href="runs.html">Runs</a> · <a href="architecture.html">Architecture</a> · <a href="compare.html">Compare</a> · <a href="evidence/product-evidence-manifest.json">Evidence receipt</a> · <a href="product.json">Product provenance</a></nav><p>Hypotheses require protected trials and human review. No automatic uploads or refactors.</p></main></html>', { flag: 'wx', mode: 0o600 });
      result = { ...manifest, files: architecture.files, manifestPath, indexPath: path.join(outDir, 'index.html') };
    }
  }
  writeJsonOrRender(result, Boolean(options['--json']), renderProductResult, stdout);
  return result;
}

module.exports = {
  PRODUCT_HELP,
  parseProductArgs,
  readProductJson,
  productAudit,
  productAuditWithVisual,
  productCommand,
  renderProductAudit,
  validateVisualEvidence,
  visualAuditRecoveryCommands
};
