const path = require('node:path');

const { writeJsonFile } = require('./command-output');
const { recommendFromFiles } = require('./recommendation-files');
const { buildV2AskContext } = require('./v2-ask-context');
const { openV2FromFiles } = require('./v2-open-links');

function writeTriage(result, outDir) {
  const absoluteDir = path.resolve(outDir);
  const file = path.join(absoluteDir, 'agentops-triage.json');
  writeJsonFile(file, result);
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

  const ask = buildV2AskContext({
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
    `Run Story: ${result.links.replay}`,
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

module.exports = {
  buildTriage,
  renderTriage,
  writeTriage
};
