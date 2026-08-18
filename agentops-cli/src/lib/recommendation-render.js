function renderRecommendationV2(recommendation) {
  const lines = ['AgentOps recommendation', ''];
  lines.push(`Action: ${recommendation.action}`);
  lines.push(`Severity: ${recommendation.severity}`);
  if (recommendation.run_id) lines.push(`Run: ${recommendation.run_id}`);
  lines.push(`Observed pattern: ${recommendation.observed_pattern}`);
  lines.push(`Next action: ${recommendation.next_action}`);
  if (recommendation.evidence?.eval) {
    const evaluation = recommendation.evidence.eval;
    lines.push(`Eval: ${evaluation.overall} (${evaluation.bucket || 'unknown'})${evaluation.reason ? ` - ${evaluation.reason}` : ''}`);
  }
  if (recommendation.evidence?.pattern) {
    const pattern = recommendation.evidence.pattern;
    lines.push(`Pattern: ${pattern.key} (${pattern.runs ?? 'unknown'} run(s), ${pattern.dimension || 'unknown'})`);
  }
  if (recommendation.evidence?.benchmark) {
    const benchmark = recommendation.evidence.benchmark;
    lines.push(`Benchmark: ${benchmark.run_id || 'unknown'} (${benchmark.decision || 'unknown'}, score ${benchmark.average_score ?? 'unknown'}, pass ${benchmark.pass_rate_pct ?? 'unknown'}%)`);
  }
  if (recommendation.evidence?.change_annotations?.length) {
    lines.push('Config changes:');
    for (const annotation of recommendation.evidence.change_annotations) {
      lines.push(`- ${annotation.component || 'config'} ${annotation.target || 'unknown'} (${annotation.change_type || 'updated'}${annotation.version ? `, ${annotation.version}` : ''})`);
    }
  }
  if (recommendation.evidence?.file_refs?.length) lines.push(`Change targets: ${recommendation.evidence.file_refs.join(', ')}`);
  if (recommendation.evidence?.dashboards?.length) {
    lines.push('Dashboards:');
    for (const dashboard of recommendation.evidence.dashboards) lines.push(`- ${dashboard.title}: ${dashboard.url}`);
  }
  lines.push('Validation:');
  for (const item of recommendation.validation || []) lines.push(`- ${item}`);
  lines.push(`Rollback condition: ${recommendation.rollback_condition}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderRecommendationV2
};
