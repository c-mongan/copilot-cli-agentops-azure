const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { hasFlag, optionValue } = require('./args');
const { writeJson } = require('./command-output');
const { generateDemoData, writeDemoData } = require('./demo/agentops-demo-data');
const { buildDemoVerifyResult } = require('./demo-verify');
const { renderV2Explanation } = require('./explain/v2-explain');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function parseRuns(value) {
  const runs = Number(value || 50);
  if (!Number.isInteger(runs) || runs <= 0 || runs > 1000) {
    throw new Error('--runs must be an integer between 1 and 1000');
  }
  return runs;
}

function flagPair(args, withFlag, withoutFlag, defaultValue = true) {
  const withValue = hasFlag(args, withFlag);
  const withoutValue = hasFlag(args, withoutFlag);
  if (withValue && withoutValue) throw new Error(`Use either ${withFlag} or ${withoutFlag}, not both`);
  if (withValue) return true;
  if (withoutValue) return false;
  return defaultValue;
}

function demoOptionsFromArgs(args = []) {
  return {
    withFailures: flagPair(args, '--with-failures', '--without-failures', true),
    withPrivacyDrops: flagPair(args, '--with-privacy-drops', '--without-privacy-drops', true),
    withGithubOutcomes: flagPair(args, '--with-github-outcomes', '--without-github-outcomes', true),
    withContent: hasFlag(args, '--with-content')
  };
}

function demoVerifyOutputPlan(args = [], options = {}) {
  const writeArtifacts = hasFlag(args, '--write');
  const requestedOut = optionValue(args, '--out', '');
  const requestedInsightsOut = optionValue(args, '--insights-out', '');
  if ((requestedOut || requestedInsightsOut) && !writeArtifacts) {
    throw new Error('demo verify output paths require --write; verification is workspace-read-only by default');
  }

  const root = options.repoRoot || repoRoot;
  const tempRoot = options.tempRoot || os.tmpdir();
  const temporaryRoot = writeArtifacts
    ? null
    : fs.mkdtempSync(path.join(tempRoot, 'agentops-demo-verify-'));
  const outDir = requestedOut
    ? path.resolve(requestedOut)
    : (writeArtifacts ? path.join(root, '.agentops', 'demo', 'latest') : temporaryRoot);
  const insightsOutDir = requestedInsightsOut
    ? path.resolve(requestedInsightsOut)
    : (writeArtifacts ? path.join(root, '.agentops', 'insights', 'latest') : path.join(temporaryRoot, 'insights'));

  return {
    outDir,
    insightsOutDir,
    writeArtifacts,
    artifactMode: writeArtifacts ? 'persistent' : 'temporary'
  };
}

function demoCommand(args = []) {
  const [subcommand = 'generate'] = args;
  if (!['generate', 'verify'].includes(subcommand)) throw new Error('demo supports: generate|verify');
  if (subcommand === 'verify') return demoVerifyCommand(args.slice(1));

  const runs = parseRuns(optionValue(args, '--runs', '50'));
  const outDir = path.resolve(optionValue(args, '--out', path.join(repoRoot, '.agentops', 'demo', 'latest')));
  const demoOptions = demoOptionsFromArgs(args);
  const result = generateDemoData({
    runs,
    ...demoOptions
  });
  const written = writeDemoData(result, outDir);

  const payload = {
    ok: result.ok,
    runs: result.runs,
    out_dir: written.out_dir,
    manifest: written.manifest,
    table_counts: result.table_counts,
    scenarios: result.scenarios,
    scenario_names: result.scenario_names,
    validation_errors: result.validation_errors,
    content_capture: demoOptions.withContent ? 'redacted_demo_content' : 'off',
    next: [
      'agentops dashboard validate',
      `ls ${written.out_dir}`
    ]
  };

  if (hasFlag(args, '--json')) {
    writeJson(payload);
  } else {
    process.stdout.write(`Generated ${payload.runs} AgentOps demo runs.\n`);
    if (demoOptions.withContent) process.stdout.write('Included redacted demo prompt/response rows in AgentOpsContent_CL.\n');
    process.stdout.write(`Output: ${payload.out_dir}\n`);
    process.stdout.write(`Manifest: ${payload.manifest}\n`);
    process.stdout.write('Next: agentops dashboard validate\n');
  }

  if (!result.ok) process.exitCode = 1;
}

function demoVerifyCommand(args = []) {
  const runs = parseRuns(optionValue(args, '--runs', '50'));
  const outputPlan = demoVerifyOutputPlan(args);
  const {
    payload,
    explanation,
    openLinks,
    recommendation
  } = buildDemoVerifyResult({
    runs,
    outDir: outputPlan.outDir,
    insightsOutDir: outputPlan.insightsOutDir,
    writeIntent: outputPlan.writeArtifacts,
    artifactMode: outputPlan.artifactMode
  });

  if (hasFlag(args, '--json')) {
    writeJson(payload);
  } else {
    process.stdout.write('AgentOps V2 demo verification\n\n');
    process.stdout.write(`Demo runs: ${payload.demo.runs}\n`);
    process.stdout.write(`Eval rows: ${payload.insights.table_counts.AgentOpsEval_CL}\n`);
    process.stdout.write(`Insight rows: ${payload.insights.table_counts.AgentOpsInsights_CL}\n`);
    process.stdout.write(`Artifacts: ${payload.artifact_mode} (${payload.write_intent ? 'explicit write' : 'workspace read-only'})\n`);
    process.stdout.write(`Dashboard links: ${payload.links.checked_links}\n\n`);
    process.stdout.write(renderV2Explanation(explanation));
    process.stdout.write(`Open Run Story: ${openLinks.links?.replay || 'unavailable'}\n`);
    process.stdout.write(`Recommended next action: ${recommendation.next_action}\n`);
  }
  if (!payload.ok) process.exitCode = 1;
}

module.exports = {
  demoOptionsFromArgs,
  demoVerifyOutputPlan,
  demoCommand,
  demoVerifyCommand,
  parseRuns
};
