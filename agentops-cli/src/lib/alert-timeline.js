function incidentTimelineFromArtifacts({ artifacts = [], createdAt, incidentId, workspaceId } = {}) {
  const created = createdAt || new Date().toISOString();
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('incident timeline requires at least one alert artifact');
  }

  const normalized = artifacts.map((artifact, index) => {
    if (!artifact || artifact.schema_version !== 'agentops.alert-artifact.v1') {
      throw new Error(`incident timeline artifact ${index + 1} must be an agentops.alert-artifact.v1 JSON file`);
    }
    if (!artifact.rule || !artifact.session || !artifact.evidence) {
      throw new Error(`incident timeline artifact ${index + 1} is missing rule, session, or evidence`);
    }
    return {
      source_index: index + 1,
      created_at: artifact.created_at || created,
      rule: artifact.rule,
      session: artifact.session,
      last: artifact.last,
      severity: artifact.action_plan && artifact.action_plan.severity ? artifact.action_plan.severity : 'review',
      status: artifact.status || { state: 'review', owner: null, ticket: null, notes: [] },
      evidence: {
        history_query: artifact.evidence.history_query,
        session_link: artifact.evidence.session_link,
        threshold_evidence_query: artifact.evidence.threshold_evidence_query
      },
      action_plan: {
        title: artifact.action_plan && artifact.action_plan.title,
        safe_metadata: artifact.action_plan && artifact.action_plan.safe_metadata,
        guardrails: artifact.action_plan && artifact.action_plan.guardrails ? artifact.action_plan.guardrails : []
      }
    };
  }).sort((left, right) => {
    if (left.created_at !== right.created_at) return String(left.created_at).localeCompare(String(right.created_at));
    if (left.rule !== right.rule) return String(left.rule).localeCompare(String(right.rule));
    return String(left.session).localeCompare(String(right.session));
  });

  const excluded = new Set(['prompts', 'responses', 'tool arguments', 'tool results', 'file contents']);
  for (const artifact of artifacts) {
    for (const item of (artifact.privacy && artifact.privacy.excluded) || []) excluded.add(item);
  }

  return {
    schema_version: 'agentops.incident-timeline.v1',
    created_at: created,
    incident_id: incidentId || `incident-${created.replace(/[^0-9]/g, '').slice(0, 14)}`,
    workspace_id: normalized[0].evidence.session_link && normalized[0].evidence.session_link.workspace_id
      ? normalized[0].evidence.session_link.workspace_id
      : workspaceId,
    privacy: {
      mode: 'metadata-only',
      excluded: Array.from(excluded)
    },
    status: {
      state: 'review',
      owner: null,
      tickets: normalized.map(item => item.status.ticket).filter(Boolean),
      notes: []
    },
    timeline: normalized.map((item, index) => ({
      sequence: index + 1,
      type: 'alert_artifact',
      at: item.created_at,
      rule: item.rule,
      session: item.session,
      severity: item.severity,
      state: item.status.state || 'review',
      summary: `AgentOps alert ${item.rule} for session ${item.session}`
    })),
    artifacts: normalized,
    next: [
      'Review the metadata-only timeline and assign an owner.',
      'Create a ticket manually only after confirming the KQL and dashboard evidence.',
      'Keep prompts, responses, tool arguments, tool results, and file contents out of incident notes.'
    ]
  };
}

module.exports = {
  incidentTimelineFromArtifacts
};
