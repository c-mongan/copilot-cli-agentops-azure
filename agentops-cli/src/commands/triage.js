const fs = require('node:fs');
const path = require('node:path');

const { hasFlag, optionValue } = require('../lib/args');
const { buildAskContext } = require('./ask-context');
const { openV2FromFiles } = require('./open');
const { recommendFromFiles, writeRecommendation } = require('./recommend');

function firstPositional(args = []) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && index + 1 < args.length && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    return arg;
  }
  return 'latest';
}

function resolveOption(args, name) {
  const value = optionValue(args, name);
  return value ? path.resolve(value) : null;
}

function writeTriage(result, outDir) {
  const absoluteDir = path.resolve(outDir);
  fs.mkdirSync(absoluteDir, { recursive: true });
  const file = path.join(absoluteDir, 'agentops-triage.json');
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return { file };
}

function buildTriage(options = {}) {
  if (!options.runsFile) throw new Error('triage requires --runs <AgentOpsRunSummary_CL.jsonl>');

  const open = openV2FromFiles({ runId: options.runId, runsFile: options.runsFile });
  if (!open.ok) {
    return {
      ok: false,
      run_id: options.runId || 'latest',
      error: open.missing_latest_reason || 'no V2 run row was found'
    };
  }

  const ask = buildAskContext({
    runId: open.run_id,
    runsFile: options.runsFile,
    eventsFile: options.eventsFile,
    toolsFile: options.toolsFile,
    privacyFile: options.privacyFile,
    githubFile: options.githubFile,
    evalsFile: options.evalsFile,
    insightsFile: options.insightsFile
  });
  const recommendation = recommendFromFiles({
    runId: open.run_id,
    runsFile: options.runsFile,
    eventsFile: options.eventsFile,
    evalsFile: options.evalsFile,
    insightsFile: options.insightsFile,
    benchmarkReportFile: options.benchmarkReportFile,
    benchmarkRunId: options.benchmarkRunId
  });

  return {
    ok: true,
    run_id: open.run_id,
    session_id: open.session_id,
    trace_id: open.trace_id,
    status: open.status,
    links: open.links,
    evidence_counts: ask.counts || {},
    recommendation: {
      action: recommendation.action,
      severity: recommendation.severity,
      observed_pattern: recommendation.observed_pattern,
      next_action: recommendation.next_action,
      pattern: recommendation.evidence?.pattern || null,
      benchmark: recommendation.evidence?.benchmark || null,
      change_annotations: recommendation.evidence?.change_annotations || [],
      change_targets: recommendation.evidence?.file_refs || [],
      dashboards: recommendation.evidence?.dashboards || []
    },
    ask_agentops: {
      prompt: ask.prompt,
      replay_url: ask.replay_url
    },
    privacy: {
      mode: ask.run?.PrivacyMode || 'strict',
      content_capture_mode: ask.run?.ContentCaptureMode || 'off',
      note: 'Metadata-only triage packet. Do not include prompts, responses, tool args, tool results, source code, file contents, URLs, request bodies, response bodies, or secrets unless content capture is explicitly approved.'
    },
    next: [
      `agentops open ${open.run_id} --runs <AgentOpsRunSummary_CL.jsonl>`,
      `agentops ask-context ${open.run_id} --runs <AgentOpsRunSummary_CL.jsonl> --events <AgentOpsEvents_CL.jsonl> --tools <AgentOpsToolCalls_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl>`,
      `agentops recommend ${open.run_id} --runs <AgentOpsRunSummary_CL.jsonl> --events <AgentOpsEvents_CL.jsonl> --evals <AgentOpsEval_CL.jsonl> --insights <AgentOpsInsights_CL.jsonl> --out <dir>`
    ]
  };
}

function renderTriage(result) {
  if (!result.ok) return `AgentOps triage\n\n${result.error}\n`;
  const lines = [
    'AgentOps triage',
    '',
    `Run: ${result.run_id}`,
    `Status: ${result.status || 'unknown'}`,
    `Run Replay: ${result.links.replay}`,
    `Ask AgentOps prompt: ready`,
    `Recommendation: ${result.recommendation.action} (${result.recommendation.severity})`,
    `Next action: ${result.recommendation.next_action}`,
    `Evidence: ${result.evidence_counts.events || 0} events, ${result.evidence_counts.failed_tools || 0} failed/denied tools, ${result.evidence_counts.insights || 0} insights`,
    `Privacy: ${result.privacy.mode}, content capture ${result.privacy.content_capture_mode}`,
    ''
  ];
  if (result.recommendation.pattern) lines.push(`Pattern: ${result.recommendation.pattern.key}`);
  if (result.recommendation.benchmark) lines.push(`Benchmark: ${result.recommendation.benchmark.run_id} (${result.recommendation.benchmark.decision || 'unknown'})`);
  if (result.recommendation.change_annotations?.length) lines.push(`Config changes: ${result.recommendation.change_annotations.map(annotation => [annotation.component, annotation.target].filter(Boolean).join(':')).filter(Boolean).join(', ')}`);
  if (result.recommendation.change_targets.length) lines.push(`Change targets: ${result.recommendation.change_targets.join(', ')}`);
  lines.push('');
  lines.push('Prompt:');
  lines.push(result.ask_agentops.prompt);
  return `${lines.join('\n')}\n`;
}

function triageCommand(args = []) {
  const runId = firstPositional(args);
  const runsFile = resolveOption(args, '--runs');
  const result = buildTriage({
    runId,
    runsFile,
    eventsFile: resolveOption(args, '--events'),
    toolsFile: resolveOption(args, '--tools'),
    privacyFile: resolveOption(args, '--privacy'),
    githubFile: resolveOption(args, '--github'),
    evalsFile: resolveOption(args, '--evals'),
    insightsFile: resolveOption(args, '--insights'),
    benchmarkReportFile: resolveOption(args, '--benchmark-report'),
    benchmarkRunId: optionValue(args, '--benchmark-run')
  });
  const outDir = optionValue(args, '--out');
  if (result.ok && outDir) {
    const triageArtifact = writeTriage(result, outDir);
    const recommendationArtifact = writeRecommendation({
      ok: true,
      action: result.recommendation.action,
      severity: result.recommendation.severity,
      run_id: result.run_id,
      session_id: result.session_id,
      trace_id: result.trace_id,
      observed_pattern: result.recommendation.observed_pattern,
      next_action: result.recommendation.next_action,
      evidence: {
        dashboards: result.recommendation.dashboards,
        pattern: result.recommendation.pattern,
        benchmark: result.recommendation.benchmark,
        change_annotations: result.recommendation.change_annotations,
        file_refs: result.recommendation.change_targets
      },
      validation: [],
      rollback_condition: 'Rollback the agent, skill, MCP, model, or instruction change if eval score drops, failures rise, privacy drops appear unexpectedly, or CI worsens.'
    }, outDir);
    result.artifacts = {
      triage: triageArtifact.file,
      recommendation: recommendationArtifact.file
    };
  }

  process.stdout.write(hasFlag(args, '--json') ? `${JSON.stringify(result, null, 2)}\n` : renderTriage(result));
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  buildTriage,
  renderTriage,
  triageCommand,
  writeTriage
};
