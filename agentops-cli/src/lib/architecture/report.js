const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 'architecture-insights.v1';

function severityForRule(rule, subStatus) {
  if (rule === 'DECLARED_NOT_OBSERVED') return 'low';
  if (rule === 'TOOL_THRASH' && subStatus === 'suspected-by-name-only') return 'low';
  if (rule === 'MECHANICAL_LLM_STEP') return 'medium';
  return 'medium';
}

function nextStepForCard(card) {
  return card.proposedChange;
}

function toInsightsRow(card, { timeGenerated = new Date().toISOString() } = {}) {
  const evidence = card.metricEvidence || {};
  const numerator = Number.isFinite(evidence.numerator) ? evidence.numerator : null;
  const denominator = Number.isFinite(evidence.denominator) ? evidence.denominator : null;
  const coverageRuns = Number.isFinite(evidence.coverageRuns) ? evidence.coverageRuns : null;
  const representativeRunId = (card.representativeRunIds || [])[0] || '';
  return {
    TimeGenerated: timeGenerated,
    InsightId: card.id,
    InsightType: `architecture-${card.rule.toLowerCase().replace(/_/g, '-')}`,
    Severity: severityForRule(card.rule, card.subStatus),
    RunId: representativeRunId,
    TraceId: '',
    Title: card.title,
    Summary: card.summary || '',
    SuggestedNextStep: nextStepForCard(card),
    Rule: card.rule,
    ArchitectureVersion: evidence.architectureVersion || '',
    Numerator: numerator,
    Denominator: denominator,
    CoverageRuns: coverageRuns,
    Status: card.status || 'open',
    ComponentRefs: card.componentRefs || [],
    Evidence: {
      interval: evidence.interval || null,
      rate: evidence.rate !== undefined ? evidence.rate : (denominator && numerator !== null ? numerator / denominator : null),
      unit: evidence.unit || 'unknown',
      configurationVersion: evidence.configurationVersion || null,
      configurationVersions: evidence.configurationVersions || [],
      taskId: evidence.taskId || null,
      taskIds: evidence.taskIds || [],
      cohortId: evidence.cohortId || null,
      executionConfigurationEvidence: evidence.executionConfigurationEvidence || null,
      coverage: evidence.coverage || null,
      evidenceIds: evidence.evidenceIds || [],
      subStatus: card.subStatus || null,
      representativeRunIds: card.representativeRunIds || [],
      coverageLimits: card.coverageLimits || null,
      rejectionTest: card.rejectionTest || 'pending',
      specSection: null
    },
    SchemaVersion: SCHEMA_VERSION
  };
}

function renderMarkdown(report) {
  const { architectureVersion, configurationVersion, configurationVersions, coverageRuns, cards, metrics, insufficientEvidence } = report;
  const lines = [];
  lines.push('# AgentOps architecture report', '');
  lines.push(`Architecture version: \`${architectureVersion.slice(0, 16)}…\``);
  lines.push(`Execution configuration version: ${configurationVersion ? `\`${configurationVersion}\`` : `unknown or mixed (${(configurationVersions || []).join(', ') || 'none recorded'})`}`);
  lines.push(`Execution configuration evidence: ${report.executionConfigurationEvidence?.completeness || 'unknown'} from ${report.executionConfigurationEvidence?.source || 'unknown'}`);
  lines.push(`Covered runs: ${coverageRuns}`);
  lines.push(`Observed complete runs: ${report.observedCoverageRuns ?? coverageRuns}`);
  lines.push(`Deferred rules: ${report.deferredRules.join(', ')} (metrics computed, cards not emitted this release)`, '');
  if (report.cohorts?.length) {
    lines.push('## Evidence cohorts', '');
    for (const cohort of report.cohorts) {
      const configuration = cohort.configurationVersion || `${cohort.configurationVersionStatus} (${(cohort.configurationVersions || []).join(', ') || 'none recorded'})`;
      const task = cohort.taskId || `${cohort.taskStatus} (${(cohort.taskIds || []).join(', ') || 'none recorded'})`;
      const metricStatus = cohort.eligibleForMetrics === false ? `excluded: ${cohort.exclusionReason}` : 'eligible';
      const executionEvidence = cohort.executionConfigurationEvidence || {};
      lines.push(`- \`${cohort.cohortId}\`: configuration ${configuration}; task ${task}; evidence ${executionEvidence.completeness || 'unknown'} from ${executionEvidence.source || 'unknown'}; ${cohort.coverageRuns} runs; ${metricStatus}`);
    }
    lines.push('');
  }
  if (insufficientEvidence) {
    lines.push('> **Insufficient evidence.** Fewer than the minimum covered runs were available; no findings were emitted. Not observed does not mean unused.', '');
  }
  lines.push('## Hypothesis cards', '');
  if (cards.length === 0) {
    lines.push('No findings in scope were triggered. The architecture engine does not emit a verdict — it only emits cards.', '');
  }
  for (const card of cards) {
    lines.push(`### ${card.rule}${card.subStatus ? ` (${card.subStatus})` : ''}`);
    lines.push(`- Title: ${card.title}`);
    if (card.summary) lines.push(`- Summary: ${card.summary}`);
    const ev = card.metricEvidence || {};
    lines.push(`- Metric unit: ${ev.unit || 'unknown'}`);
    lines.push(`- Execution configuration: ${ev.configurationVersion || `${ev.coverage?.configurationVersionStatus || 'unknown'} (${(ev.configurationVersions || []).join(', ') || 'none recorded'})`}`);
    lines.push(`- Task cohort: ${ev.taskId || `${ev.coverage?.taskStatus || 'unknown'} (${(ev.taskIds || []).join(', ') || 'none recorded'})`}`);
    lines.push(`- Cohort ID: ${ev.cohortId || 'unknown'}`);
    lines.push(`- Configuration evidence: ${ev.executionConfigurationEvidence?.completeness || 'unknown'} from ${ev.executionConfigurationEvidence?.source || 'unknown'}`);
    if (Number.isFinite(ev.numerator) && Number.isFinite(ev.denominator)) {
      const rate = ev.denominator > 0 ? (ev.numerator / ev.denominator * 100).toFixed(1) + '%' : 'n/a';
      lines.push(`- Evidence: ${ev.numerator}/${ev.denominator} (${rate}), coverage ${ev.coverageRuns} runs`);
      if (ev.interval) lines.push(`- 95% Wilson interval: [${ev.interval.lower.toFixed(3)}, ${ev.interval.upper.toFixed(3)}]`);
    }
    if (card.componentRefs?.length) {
      lines.push(`- Components: ${card.componentRefs.map(ref => `${ref.kind}:${ref.name || ref.path}`).join(', ')}`);
    }
    if (card.representativeRunIds?.length) lines.push(`- Representative runs: ${card.representativeRunIds.join(', ')}`);
    if (ev.evidenceIds?.length) lines.push(`- Exact evidence IDs: ${ev.evidenceIds.join(', ')}`);
    lines.push(`- Proposed change: ${card.proposedChange}`);
    lines.push(`- Rejection test: ${card.rejectionTest}`);
    lines.push('');
  }
  lines.push('## Metric summary', '');
  const covRuns = metrics?.coverageRuns ?? coverageRuns;
  lines.push(`- Skill activation rows: ${metrics?.skillActivationRate?.length || 0}`);
  lines.push(`- Skill co-activation pairs: ${metrics?.skillCoactivation?.length || 0}`);
  lines.push(`- Reference-load given skill rows: ${metrics?.referenceLoadGivenSkill?.length || 0}`);
  lines.push(`- Reread rate rows: ${metrics?.rereadRate?.length || 0}`);
  lines.push(`- Tool repetition rows: ${metrics?.toolRepetition?.length || 0}`);
  lines.push(`- Script health rows: ${metrics?.scriptHealth?.length || 0}`);
  lines.push(`- Context pressure: computed over ${covRuns} runs`);
  lines.push('');
  return lines.join('\n') + '\n';
}

function buildReport({ graph, findings, invalidLedgerRows = 0, generatedAt = new Date().toISOString() }) {
  const report = {
    architectureVersion: graph.architectureVersion,
    configurationVersion: findings.metrics?.configurationVersion || null,
    configurationVersions: findings.metrics?.configurationVersions || [],
    configurationVersionStatus: findings.metrics?.coverage?.configurationVersionStatus || 'unknown',
    executionConfigurationEvidence: findings.metrics?.executionConfigurationEvidence || null,
    taskId: findings.metrics?.taskId || null,
    taskIds: findings.metrics?.taskIds || [],
    taskStatus: findings.metrics?.coverage?.taskStatus || 'unknown',
    cohorts: findings.cohorts || [],
    generatedAt,
    coverageRuns: findings.coverageRuns,
    observedCoverageRuns: findings.metrics?.observedCoverageRuns ?? findings.coverageRuns,
    insufficientEvidence: findings.insufficientEvidence,
    cards: findings.cards,
    metrics: findings.metrics,
    deferredRules: findings.deferredRules,
    invalidLedgerRows,
    inventory: {
      agents: graph.agents.length,
      skills: graph.skills.length,
      references: graph.skills.reduce((sum, s) => sum + s.references.length, 0),
      scripts: graph.runtimeScripts.length
    }
  };
  const azureRows = findings.cards.map(card => toInsightsRow(card, { timeGenerated: generatedAt }));
  return { report, azureRows };
}

function writeReport(report, azureRows, outDir) {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(outDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('report output must be a real directory');
  const jsonPath = path.join(outDir, 'architecture-report.json');
  const markdownPath = path.join(outDir, 'architecture-report.md');
  const insightsPath = path.join(outDir, 'AgentOpsInsights_CL.jsonl');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(markdownPath, renderMarkdown(report), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(insightsPath, azureRows.map(row => JSON.stringify(row)).join('\n') + (azureRows.length > 0 ? '\n' : ''), { flag: 'wx', mode: 0o600 });
  return { jsonPath, markdownPath, insightsPath };
}

module.exports = {
  SCHEMA_VERSION,
  buildReport,
  renderMarkdown,
  severityForRule,
  toInsightsRow,
  writeReport
};
