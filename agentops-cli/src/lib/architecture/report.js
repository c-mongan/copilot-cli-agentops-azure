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
  const { architectureVersion, coverageRuns, cards, metrics, insufficientEvidence } = report;
  const lines = [];
  lines.push('# AgentOps architecture report', '');
  lines.push(`Architecture version: \`${architectureVersion.slice(0, 16)}…\``);
  lines.push(`Covered runs: ${coverageRuns}`);
  lines.push(`Deferred rules: ${report.deferredRules.join(', ')} (metrics computed, cards not emitted this release)`, '');
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
    if (Number.isFinite(ev.numerator) && Number.isFinite(ev.denominator)) {
      const rate = ev.denominator > 0 ? (ev.numerator / ev.denominator * 100).toFixed(1) + '%' : 'n/a';
      lines.push(`- Evidence: ${ev.numerator}/${ev.denominator} (${rate}), coverage ${ev.coverageRuns} runs`);
      if (ev.interval) lines.push(`- 95% Wilson interval: [${ev.interval.lower.toFixed(3)}, ${ev.interval.upper.toFixed(3)}]`);
    }
    if (card.componentRefs?.length) {
      lines.push(`- Components: ${card.componentRefs.map(ref => `${ref.kind}:${ref.name || ref.path}`).join(', ')}`);
    }
    if (card.representativeRunIds?.length) lines.push(`- Representative runs: ${card.representativeRunIds.join(', ')}`);
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
    generatedAt,
    coverageRuns: findings.coverageRuns,
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
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'architecture-report.json');
  const markdownPath = path.join(outDir, 'architecture-report.md');
  const insightsPath = path.join(outDir, 'AgentOpsInsights_CL.jsonl');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));
  fs.writeFileSync(insightsPath, azureRows.map(row => JSON.stringify(row)).join('\n') + (azureRows.length > 0 ? '\n' : ''));
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
