const crypto = require('node:crypto');

const { createAlerts } = require('../agentops-cli/src/alerts');
const { validateRecommendationRow } = require('../agentops-cli/src/lib/schema/recommendation-schema');

const alertRuleNames = new Set([
  'high-aiu',
  'cost-spike',
  'runaway-tool-loop',
  'failed-spans',
  'content-capture'
]);

function stringValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

const sharedWriteTables = new Set([
  'AgentOpsRecommendations_CL',
  'AgentOpsSavedViews_CL'
]);

const sharedWriteRequiredColumns = {
  AgentOpsRecommendations_CL: ['TimeGenerated', 'RecommendationId', 'Action', 'Severity', 'ObservedPattern', 'NextAction'],
  AgentOpsSavedViews_CL: ['TimeGenerated', 'SavedViewId', 'Name', 'Url', 'QueryHash']
};

const sharedWriteLeakPatterns = [
  /SECRET_FAKE_TEST_VALUE/i,
  /api_key\s*=/i,
  /cat ~\/\.ssh\/id_rsa/i,
  /raw transcript/i,
  /gen_ai\.input\.messages/i,
  /gen_ai\.output\.messages/i,
  /prompt\s*=/i,
  /tool_args\s*=/i,
  /tool results?/i,
  /file_content\s*=/i
];

function stableId(value, prefix = 'row') {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function safeBlobSegment(value) {
  return stringValue(value)
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

function htmlEscape(value) {
  return stringValue(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rowIdFor(table, row) {
  const candidate = table === 'AgentOpsRecommendations_CL'
    ? row.RecommendationId
    : row.SavedViewId;
  return safeBlobSegment(candidate) || stableId(JSON.stringify(row));
}

function validateSharedWriteRow(table, row = {}) {
  const errors = [];
  const text = JSON.stringify(row);
  if (!sharedWriteTables.has(table)) errors.push(`unsupported table: ${table || '<missing>'}`);
  if (!row || typeof row !== 'object' || Array.isArray(row)) errors.push('row must be an object');

  for (const column of sharedWriteRequiredColumns[table] || []) {
    if (row[column] === undefined || row[column] === null || row[column] === '') errors.push(`${table}: missing required column ${column}`);
  }

  if (table === 'AgentOpsRecommendations_CL') {
    const validation = validateRecommendationRow(row);
    if (!validation.ok) errors.push(...validation.errors.map(error => `${table}: ${error}`));
  }

  const leaks = sharedWriteLeakPatterns
    .filter(pattern => pattern.test(text))
    .map(pattern => pattern.source);
  if (leaks.length > 0) errors.push(`privacy scan found ${leaks.length} content-like or secret-like match(es)`);

  return { ok: errors.length === 0, errors, leaks };
}

function buildSharedStoreWrite(payload = {}, options = {}) {
  const table = stringValue(payload.table || payload.Table).trim();
  const row = payload.row && typeof payload.row === 'object' ? payload.row : {};
  const owner = stringValue(payload.owner || payload.Owner || process.env.AGENTOPS_SHARED_STORE_OWNER).trim();
  const prefix = safeBlobSegment(options.prefix || process.env.AGENTOPS_SHARED_STORE_PREFIX || payload.prefix || 'agentops-shared');
  const validation = validateSharedWriteRow(table, row);
  const id = safeBlobSegment(options.id || payload.id) || rowIdFor(table, row);
  const blobPath = [prefix, table, `${id}.json`].filter(Boolean).join('/');
  const writtenAt = stringValue(options.writtenAt || new Date().toISOString());

  const packet = {
    schema_version: 'agentops.shared-store-write.v1',
    mode: 'metadata-only-shared-store-write',
    status: validation.ok ? 'ready' : 'rejected',
    table: table || null,
    id,
    owner: owner || null,
    blob_path: blobPath,
    row: validation.ok ? row : null,
    errors: validation.errors,
    privacy: {
      mode: 'metadata-only',
      leaks: validation.leaks,
      excluded: ['prompts', 'responses', 'tool arguments', 'tool results', 'source code', 'file contents']
    },
    guardrails: [
      'Accept only metadata-only saved-view and recommendation rows.',
      'Do not store prompts, responses, tool arguments, tool results, source code, or file contents.',
      'Use storage RBAC and function-level authorization for hosted writes.'
    ]
  };

  if (!validation.ok) return packet;

  return {
    ...packet,
    blob: {
      path: blobPath,
      content: `${JSON.stringify({
        schema_version: 'agentops.shared-store-blob.v1',
        written_at: writtenAt,
        table,
        id,
        owner: owner || null,
        row
      }, null, 2)}\n`
    },
    next: [
      'Ingest or export the shared blob row into AgentOpsRecommendations_CL or AgentOpsSavedViews_CL.',
      'Review owner and privacy metadata before sharing the artifact beyond the team.'
    ]
  };
}

function buildSharedStoreEditor(options = {}) {
  const basePath = stringValue(options.basePath || process.env.AGENTOPS_SHARED_STORE_API_BASE || '/api/shared-store').trim() || '/api/shared-store';
  const exampleRecommendation = {
    TimeGenerated: '2026-06-03T12:00:00.000Z',
    RecommendationId: 'rec-123',
    Action: 'reduce_context',
    Severity: 'medium',
    ObservedPattern: 'context pressure',
    NextAction: 'Open Run Replay',
    DashboardTitles: ['Run Replay'],
    DashboardCount: 1,
    Validation: ['Run benchmark'],
    RollbackCondition: 'Revert if eval drops'
  };
  const exampleSavedView = {
    TimeGenerated: '2026-06-03T12:00:00.000Z',
    SavedViewId: 'view-123',
    Name: 'latest-risk',
    Url: 'https://grafana.example/d/agentops-session-detail',
    QueryHash: 'query_123'
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentOps Shared Store Editor</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    body { margin: 0; background: #f7f8fa; color: #1f2937; }
    main { max-width: 960px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { line-height: 1.5; }
    label { display: block; margin: 16px 0 6px; font-weight: 650; }
    input, select, textarea, button { box-sizing: border-box; width: 100%; font: inherit; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; }
    textarea { min-height: 280px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    button { width: auto; margin-top: 16px; color: white; background: #2563eb; border-color: #2563eb; cursor: pointer; }
    button.secondary { background: white; color: #1f2937; border-color: #cbd5e1; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .note, pre { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (prefers-color-scheme: dark) {
      body { background: #0b1020; color: #e5e7eb; }
      input, select, textarea, .note, pre, button.secondary { background: #111827; color: #e5e7eb; border-color: #374151; }
    }
    @media (max-width: 720px) { .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>AgentOps Shared Store Editor</h1>
    <p class="note">Create one metadata-only recommendation or saved investigation row. This page posts to the hosted shared-store write API and rejects prompts, responses, tool arguments, tool results, source code, file contents, and secret-like payloads.</p>
    <div class="row">
      <div>
        <label for="table">Artifact type</label>
        <select id="table">
          <option value="AgentOpsRecommendations_CL">Recommendation</option>
          <option value="AgentOpsSavedViews_CL">Saved investigation</option>
        </select>
      </div>
      <div>
        <label for="owner">Owner</label>
        <input id="owner" autocomplete="off" placeholder="agentops-oncall">
      </div>
    </div>
    <label for="id">Artifact id</label>
    <input id="id" autocomplete="off" placeholder="rec-123 or view-123">
    <label for="row">Metadata row JSON</label>
    <textarea id="row" spellcheck="false"></textarea>
    <div class="actions">
      <button id="submit" type="button">Save metadata artifact</button>
      <button id="sample" class="secondary" type="button">Load sample</button>
    </div>
    <label for="result">Result</label>
    <pre id="result" aria-live="polite">Ready.</pre>
  </main>
  <script>
    const apiBase = ${JSON.stringify(basePath)};
    const samples = {
      AgentOpsRecommendations_CL: ${JSON.stringify(exampleRecommendation, null, 2)},
      AgentOpsSavedViews_CL: ${JSON.stringify(exampleSavedView, null, 2)}
    };
    const table = document.getElementById('table');
    const row = document.getElementById('row');
    const id = document.getElementById('id');
    const owner = document.getElementById('owner');
    const result = document.getElementById('result');
    function loadSample() {
      row.value = JSON.stringify(samples[table.value], null, 2);
      id.value = table.value === 'AgentOpsRecommendations_CL' ? samples[table.value].RecommendationId : samples[table.value].SavedViewId;
    }
    table.addEventListener('change', loadSample);
    document.getElementById('sample').addEventListener('click', loadSample);
    document.getElementById('submit').addEventListener('click', async () => {
      try {
        const parsed = JSON.parse(row.value);
        const response = await fetch(apiBase + '/' + encodeURIComponent(table.value) + '/' + encodeURIComponent(id.value || 'draft'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owner: owner.value, row: parsed })
        });
        const payload = await response.json();
        result.textContent = JSON.stringify(payload, null, 2);
      } catch (error) {
        result.textContent = JSON.stringify({ status: 'invalid', error: error.message }, null, 2);
      }
    });
    loadSample();
  </script>
</body>
</html>`;
}

function buildAskAgentOpsLaunch(payload = {}, options = {}) {
  const hydration = hydrateAskAgentOpsPayload(payload, options.sharedStoreBlobs || {});
  payload = hydration.payload;
  const runId = stringValue(payload.run_id || payload.runId || payload.RunId).trim();
  const sessionId = stringValue(payload.session_id || payload.sessionId || payload.SessionId).trim();
  const traceId = stringValue(payload.trace_id || payload.traceId || payload.TraceId).trim();
  const last = stringValue(payload.last || payload.time_range || payload.timeRange || '24h').trim() || '24h';
  const dashboardUrl = stringValue(payload.dashboard_url || payload.dashboardUrl || payload.url).trim();
  const selectedEvent = stringValue(payload.selected_event || payload.selectedEvent || payload.event).trim();
  const benchmark = stringValue(payload.benchmark || payload.benchmark_run_id || payload.benchmarkRunId).trim();
  const recommendation = recommendationEvidenceFromPayload(payload);
  const savedView = savedViewEvidenceFromPayload(payload);
  const alertHandoff = alertHandoffEvidenceFromPayload(payload);
  const assistantBaseUrl = stringValue(options.assistantBaseUrl || payload.assistant_url || process.env.AGENTOPS_ASSISTANT_URL).trim();
  const errors = [];

  if (!runId && !sessionId && !traceId) errors.push('run_id, session_id, or trace_id is required');
  if (!/^\d+[mhd]$/.test(last)) errors.push(`invalid time range: ${last}`);
  if (hydration.context.errors.length) errors.push(...hydration.context.errors.map(error => `shared_context: ${error}`));
  if (recommendation?.errors.length) errors.push(...recommendation.errors.map(error => `recommendation: ${error}`));
  if (savedView?.errors.length) errors.push(...savedView.errors.map(error => `saved_view: ${error}`));
  if (alertHandoff?.errors.length) errors.push(...alertHandoff.errors.map(error => `alert_handoff: ${error}`));

  const identity = [
    runId ? `run ${runId}` : '',
    sessionId ? `session ${sessionId}` : '',
    traceId ? `trace ${traceId}` : ''
  ].filter(Boolean).join(', ');
  const query = `AgentOpsRunSummary_CL | where TimeGenerated > ago(${last}) | where RunId == "${runId}" or SessionId == "${sessionId}" or TraceId == "${traceId}" | project TimeGenerated, RunId, SessionId, TraceId, OutcomeStatus, OutcomeReason`;
  const prompt = [
    `Investigate AgentOps ${identity || 'run context'}.`,
    dashboardUrl ? `Dashboard: ${dashboardUrl}` : '',
    `Time range: ${last}.`,
    `Start with KQL: ${query}`,
    selectedEvent ? `Selected event: ${selectedEvent}.` : '',
    benchmark ? `Recent benchmark: ${benchmark}.` : '',
    savedView?.summary?.name ? `Saved view: ${savedView.summary.name}.` : '',
    alertHandoff?.summary?.rule ? `Alert handoff: ${alertHandoff.summary.rule} for ${alertHandoff.summary.session}.` : '',
    'Use only metadata from AgentOps dashboards, KQL, and exported artifacts.',
    'Return evidence, root-cause candidates, one minimal proposed patch or workflow action, validation benchmark/query, and rollback condition.',
    'Do not request or enable prompt, response, source code, file content, tool argument, tool result, URL, request body, response body, or secret capture.'
  ].filter(Boolean).join('\n');
  const assistantResponse = errors.length ? null : buildAskAgentOpsResponse({
    runId,
    sessionId,
    traceId,
    last,
    dashboardUrl,
    selectedEvent,
    benchmark,
    recommendation: recommendation?.summary || null,
    savedView: savedView?.summary || null,
    alertHandoff: alertHandoff?.summary || null
  });

  return {
    schema_version: 'agentops.ask-agentops-launch.v1',
    mode: 'metadata-only-assistant-launch',
    status: errors.length ? 'invalid' : 'ready',
    run_id: runId || null,
    session_id: sessionId || null,
    trace_id: traceId || null,
    last,
    dashboard_url: dashboardUrl || null,
    selected_event: selectedEvent || null,
    benchmark_run_id: benchmark || null,
    recommendation: recommendation?.summary || null,
    saved_view: savedView?.summary || null,
    alert_handoff: alertHandoff?.summary || null,
    shared_context: hydration.context,
    prompt: errors.length ? null : prompt,
    assistant_response: assistantResponse,
    launch_url: !errors.length && assistantBaseUrl
      ? `${assistantBaseUrl}${assistantBaseUrl.includes('?') ? '&' : '?'}q=${encodeURIComponent(prompt)}`
      : null,
    errors,
    privacy: {
      mode: 'metadata-only',
      excluded: ['prompts', 'responses', 'tool arguments', 'tool results', 'source code', 'file contents', 'request bodies', 'response bodies', 'secrets']
    },
    guardrails: [
      'Launch with run/session/trace metadata only.',
      'Keep prompts, responses, tool arguments, tool results, source code, and file contents out of the assistant context.',
      'Use the returned prompt as review context; do not mutate systems without explicit operator approval.'
    ]
  };
}

function objectPayload(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sharedBlobPayload(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return objectPayload(value.toString('utf8'));
  return objectPayload(value);
}

function rowFromSharedBlob(blob, expectedTable) {
  const parsed = sharedBlobPayload(blob);
  if (!parsed) return { row: null, error: 'shared blob is empty or invalid JSON' };
  const table = stringValue(parsed.table || parsed.Table).trim();
  if (expectedTable && table && table !== expectedTable) return { row: null, error: `shared blob table mismatch: expected ${expectedTable}, got ${table}` };
  const row = parsed.row && typeof parsed.row === 'object' && !Array.isArray(parsed.row) ? parsed.row : parsed;
  return { row, error: null };
}

function hydrateAskAgentOpsPayload(payload = {}, sharedStoreBlobs = {}) {
  const hydrated = { ...payload };
  const errors = [];
  const sources = [];
  const definitions = [
    {
      field: 'recommendation',
      id: stringValue(payload.recommendation_blob_id || payload.recommendationBlobId).trim(),
      blob: sharedStoreBlobs.recommendationBlob,
      table: 'AgentOpsRecommendations_CL'
    },
    {
      field: 'saved_view',
      id: stringValue(payload.saved_view_blob_id || payload.savedViewBlobId).trim(),
      blob: sharedStoreBlobs.savedViewBlob,
      table: 'AgentOpsSavedViews_CL'
    },
    {
      field: 'alert_handoff',
      id: stringValue(payload.alert_handoff_blob_id || payload.alertHandoffBlobId).trim(),
      blob: sharedStoreBlobs.alertHandoffBlob,
      table: ''
    }
  ];

  for (const item of definitions) {
    if (!item.id) continue;
    if (hydrated[item.field]) {
      sources.push(`${item.field}=inline`);
      continue;
    }
    if (!item.blob) {
      errors.push(`${item.field}: shared blob ${item.id} was not loaded`);
      continue;
    }
    const result = rowFromSharedBlob(item.blob, item.table);
    if (result.error) {
      errors.push(`${item.field}: ${result.error}`);
      continue;
    }
    hydrated[item.field] = result.row;
    sources.push(`${item.field}=shared:${item.id}`);
  }

  return {
    payload: hydrated,
    context: {
      mode: sources.length ? 'shared-store-hydrated' : 'inline-or-empty',
      sources,
      errors
    }
  };
}

function recommendationEvidenceFromPayload(payload = {}) {
  const row = objectPayload(payload.recommendation || payload.recommendation_row || payload.recommendationRow);
  if (!row) return null;

  const validation = validateRecommendationRow(row);
  if (!validation.ok) return { summary: null, errors: validation.errors };

  const artifactFiles = Array.isArray(row.BenchmarkArtifactFiles)
    ? row.BenchmarkArtifactFiles.map(item => ({
      task_id: stringValue(item?.task_id),
      change: stringValue(item?.change),
      path: stringValue(item?.path)
    })).filter(item => item.path).slice(0, 50)
    : [];
  const artifactContentDiffFiles = Array.isArray(row.BenchmarkArtifactContentDiffs)
    ? row.BenchmarkArtifactContentDiffs.map(item => ({
      task_id: stringValue(item?.task_id),
      change: stringValue(item?.change),
      path: stringValue(item?.path)
    })).filter(item => item.path).slice(0, 50)
    : [];

  return {
    summary: {
      recommendation_id: stringValue(row.RecommendationId),
      time_generated: stringValue(row.TimeGenerated),
      run_id: stringValue(row.RunId),
      session_id: stringValue(row.SessionId),
      trace_id: stringValue(row.TraceId),
      action: stringValue(row.Action),
      severity: stringValue(row.Severity),
      observed_pattern: stringValue(row.ObservedPattern),
      next_action: stringValue(row.NextAction),
      benchmark_run_id: stringValue(row.BenchmarkRunId),
      benchmark_decision: stringValue(row.BenchmarkDecision),
      benchmark_artifact_files: artifactFiles,
      benchmark_artifact_content_diff_files: artifactContentDiffFiles,
      expected_metric_movement: row.ExpectedMetricMovement && typeof row.ExpectedMetricMovement === 'object' && !Array.isArray(row.ExpectedMetricMovement) ? row.ExpectedMetricMovement : {},
      before_telemetry: row.BeforeTelemetry && typeof row.BeforeTelemetry === 'object' && !Array.isArray(row.BeforeTelemetry) ? row.BeforeTelemetry : {},
      after_telemetry: row.AfterTelemetry && typeof row.AfterTelemetry === 'object' && !Array.isArray(row.AfterTelemetry) ? row.AfterTelemetry : {},
      observed_metric_movement: row.ObservedMetricMovement && typeof row.ObservedMetricMovement === 'object' && !Array.isArray(row.ObservedMetricMovement) ? row.ObservedMetricMovement : {},
      change_target_refs: Array.isArray(row.ChangeTargetRefs) ? row.ChangeTargetRefs.map(stringValue).filter(Boolean).slice(0, 50) : [],
      validation: Array.isArray(row.Validation) ? row.Validation.map(stringValue).filter(Boolean).slice(0, 20) : [],
      rollback_condition: stringValue(row.RollbackCondition),
      dashboard_titles: Array.isArray(row.DashboardTitles) ? row.DashboardTitles.map(stringValue).filter(Boolean).slice(0, 20) : [],
      operator_review: row.OperatorReview && typeof row.OperatorReview === 'object' && !Array.isArray(row.OperatorReview) ? row.OperatorReview : {}
    },
    errors: []
  };
}

function safeStringArray(value, limit = 20) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean).slice(0, limit) : [];
}

function safeAnnotationRefs(row = {}) {
  return safeStringArray(row.ChangeTargetRefs || row.change_target_refs, 50);
}

function savedViewEvidenceFromPayload(payload = {}) {
  const row = objectPayload(payload.saved_view || payload.savedView || payload.saved_view_row || payload.savedViewRow);
  if (!row) return null;
  const errors = [];
  for (const field of ['SavedViewId', 'Name', 'Url', 'QueryHash']) {
    if (!stringValue(row[field]).trim()) errors.push(`missing required saved-view field: ${field}`);
  }
  const text = JSON.stringify(row);
  const leaks = sharedWriteLeakPatterns.filter(pattern => pattern.test(text));
  if (leaks.length) errors.push(`privacy scan found ${leaks.length} content-like or secret-like match(es)`);
  if (errors.length) return { summary: null, errors };
  return {
    summary: {
      saved_view_id: stringValue(row.SavedViewId),
      name: stringValue(row.Name),
      url: stringValue(row.Url),
      query_hash: stringValue(row.QueryHash),
      session_id: stringValue(row.SessionId),
      description: stringValue(row.Description),
      tags: safeStringArray(row.Tags || row.tags, 20),
      change_annotation_count: Number(row.ChangeAnnotationCount || 0),
      change_target_refs: safeAnnotationRefs(row),
      change_annotations: Array.isArray(row.ChangeAnnotations) ? row.ChangeAnnotations.slice(0, 20).map(annotation => ({
        component: stringValue(annotation?.component),
        target: stringValue(annotation?.target),
        change_type: stringValue(annotation?.change_type),
        change_id: stringValue(annotation?.change_id),
        version: stringValue(annotation?.version)
      })) : []
    },
    errors: []
  };
}

function alertHandoffEvidenceFromPayload(payload = {}) {
  const handoff = objectPayload(payload.alert_handoff || payload.alertHandoff || payload.handoff);
  if (!handoff) return null;
  const errors = [];
  if (handoff.schema_version && handoff.schema_version !== 'agentops.alert-handoff.v1') errors.push(`unsupported alert handoff schema: ${handoff.schema_version}`);
  if (!stringValue(handoff.alert?.rule).trim()) errors.push('missing alert rule');
  if (!stringValue(handoff.alert?.session).trim()) errors.push('missing alert session');
  const text = JSON.stringify(handoff);
  const leaks = sharedWriteLeakPatterns.filter(pattern => pattern.test(text));
  if (leaks.length) errors.push(`privacy scan found ${leaks.length} content-like or secret-like match(es)`);
  if (errors.length) return { summary: null, errors };
  const configChanges = handoff.evidence?.config_changes || {};
  return {
    summary: {
      schema_version: stringValue(handoff.schema_version || 'agentops.alert-handoff.v1'),
      rule: stringValue(handoff.alert?.rule),
      session: stringValue(handoff.alert?.session),
      last: stringValue(handoff.alert?.last),
      severity: stringValue(handoff.alert?.severity),
      owner: stringValue(handoff.status?.owner || handoff.ownership?.owners?.[0]),
      state: stringValue(handoff.status?.state),
      session_link: handoff.evidence?.detail?.session_link || null,
      history_query: stringValue(handoff.evidence?.detail?.history_query),
      config_change_query: stringValue(configChanges.query),
      config_change_count: Number(configChanges.matched_count || 0),
      change_annotations: Array.isArray(configChanges.matched_annotations) ? configChanges.matched_annotations.slice(0, 20).map(annotation => ({
        component: stringValue(annotation?.component),
        target: stringValue(annotation?.target),
        change_type: stringValue(annotation?.change_type),
        change_id: stringValue(annotation?.change_id),
        version: stringValue(annotation?.version)
      })) : [],
      operator_steps: safeStringArray(handoff.operator_steps, 20),
      guardrails: safeStringArray(handoff.guardrails, 20)
    },
    errors: []
  };
}

function reviewDecisionForRecommendation(recommendation = {}) {
  const movementStatus = stringValue(recommendation.observed_metric_movement?.status);
  const benchmarkDecision = stringValue(recommendation.benchmark_decision);
  if (movementStatus === 'regressed' || benchmarkDecision === 'reject') return 'reject';
  if (movementStatus === 'improved' && benchmarkDecision !== 'review') return 'approve';
  return 'needs-review';
}

function reviewedRecommendationRow(recommendation = {}, decision = 'needs-review') {
  const dashboardTitles = Array.isArray(recommendation.dashboard_titles) ? recommendation.dashboard_titles : [];
  return {
    TimeGenerated: recommendation.time_generated || new Date(0).toISOString(),
    RecommendationId: recommendation.recommendation_id || '',
    RunId: recommendation.run_id || '',
    SessionId: recommendation.session_id || '',
    TraceId: recommendation.trace_id || '',
    Action: recommendation.action || 'review_recommendation',
    Severity: recommendation.severity || 'medium',
    ObservedPattern: recommendation.observed_pattern || 'Recommendation review requested.',
    NextAction: recommendation.next_action || 'Review recommendation evidence, metric movement, validation, and rollback before applying a change.',
    BenchmarkRunId: recommendation.benchmark_run_id || '',
    BenchmarkDecision: recommendation.benchmark_decision || '',
    BenchmarkArtifactFiles: recommendation.benchmark_artifact_files || [],
    BenchmarkArtifactContentDiffs: recommendation.benchmark_artifact_content_diff_files || [],
    ExpectedMetricMovement: recommendation.expected_metric_movement || {},
    BeforeTelemetry: recommendation.before_telemetry || {},
    AfterTelemetry: recommendation.after_telemetry || {},
    ObservedMetricMovement: recommendation.observed_metric_movement || {},
    ChangeTargetRefs: recommendation.change_target_refs || [],
    DashboardTitles: dashboardTitles,
    DashboardCount: dashboardTitles.length,
    Validation: recommendation.validation || [],
    RollbackCondition: recommendation.rollback_condition || 'Reject or rollback if validation fails, metric movement regresses, or privacy signals appear.',
    OperatorReview: {
      status: decision,
      decision,
      reviewer: '',
      reviewed_at: '',
      note: '',
      source: 'ask-agentops-guided-review'
    }
  };
}

function buildRecommendationReview(recommendation = {}) {
  if (!recommendation?.recommendation_id) return null;
  const decision = reviewDecisionForRecommendation(recommendation);
  const movementStatus = stringValue(recommendation.observed_metric_movement?.status) || 'unknown';
  const benchmarkDecision = stringValue(recommendation.benchmark_decision) || 'unknown';
  const reasons = [
    movementStatus !== 'unknown' ? `observed metric movement is ${movementStatus}` : '',
    benchmarkDecision !== 'unknown' ? `benchmark decision is ${benchmarkDecision}` : '',
    recommendation.change_target_refs?.length ? `${recommendation.change_target_refs.length} change target(s) linked` : '',
    recommendation.validation?.length ? `${recommendation.validation.length} validation step(s) listed` : ''
  ].filter(Boolean);
  return {
    schema_version: 'agentops.recommendation-guided-review.v1',
    mode: 'metadata-only-recommendation-review',
    status: decision,
    recommendation_id: recommendation.recommendation_id,
    default_decision: decision,
    reasons,
    shared_store: {
      table: 'AgentOpsRecommendations_CL',
      id: recommendation.recommendation_id,
      post_path: `/api/shared-store/AgentOpsRecommendations_CL/${encodeURIComponent(recommendation.recommendation_id)}`,
      reviewed_row_template: reviewedRecommendationRow(recommendation, decision)
    },
    action_plan_command: `agentops recommend action-plan --recommendation-id ${recommendation.recommendation_id}`,
    actions: [
      { decision: 'approve', label: 'Approve recommendation for guarded action' },
      { decision: 'reject', label: 'Reject recommendation' }
    ],
    guardrails: [
      'Approve only after benchmark evidence, metric movement, validation, and rollback are reviewed.',
      'Reject if after-run movement regresses, validation is missing, or privacy/safety signals appear.',
      'This review writes metadata only; it does not edit repositories, change Azure resources, or route tickets.'
    ]
  };
}

function buildAskAgentOpsResponse(context = {}) {
  const recommendation = context.recommendation || null;
  const savedView = context.savedView || null;
  const alertHandoff = context.alertHandoff || null;
  const evidence = [
    context.runId ? `RunId=${context.runId}` : '',
    context.sessionId ? `SessionId=${context.sessionId}` : '',
    context.traceId ? `TraceId=${context.traceId}` : '',
    `TimeRange=${context.last}`,
    context.dashboardUrl ? 'RunReplayUrl=provided' : '',
    context.selectedEvent ? `SelectedEvent=${context.selectedEvent}` : '',
    context.benchmark ? `BenchmarkRunId=${context.benchmark}` : '',
    recommendation?.recommendation_id ? `RecommendationId=${recommendation.recommendation_id}` : '',
    recommendation?.benchmark_run_id ? `RecommendationBenchmarkRunId=${recommendation.benchmark_run_id}` : '',
    recommendation?.change_target_refs?.length ? `ChangeTargetRefs=${recommendation.change_target_refs.join(', ')}` : '',
    recommendation?.observed_metric_movement?.status ? `MetricMovementStatus=${recommendation.observed_metric_movement.status}` : '',
    savedView?.saved_view_id ? `SavedViewId=${savedView.saved_view_id}` : '',
    savedView?.change_target_refs?.length ? `SavedViewChangeTargetRefs=${savedView.change_target_refs.join(', ')}` : '',
    alertHandoff?.rule ? `AlertHandoff=${alertHandoff.rule}/${alertHandoff.session}` : '',
    alertHandoff?.config_change_count ? `AlertConfigChangeCount=${alertHandoff.config_change_count}` : ''
  ].filter(Boolean);

  const rootCauseCandidates = [
    recommendation?.observed_pattern
      ? `Use the linked recommendation pattern: ${recommendation.observed_pattern}`
      : '',
    context.selectedEvent
      ? `Start with the selected event "${context.selectedEvent}" and inspect adjacent run timeline rows.`
      : 'Start with failed, denied, high-cost, or high-latency rows in the run timeline.',
    context.benchmark
      ? 'Compare the linked benchmark run before treating this as safe to promote.'
      : 'Check whether the latest recommendation or eval row exists before proposing a change.',
    savedView?.name
      ? `Use saved view "${savedView.name}" as the durable investigation entry point.`
      : '',
    alertHandoff?.rule
      ? `Review alert handoff ${alertHandoff.rule} and its config-change annotations before routing or changing thresholds.`
      : '',
    'Confirm privacy/safety signals before requesting any additional telemetry.'
  ];

  return {
    mode: 'metadata-only-assistant-response',
    status: 'draft',
    summary: 'Open the run-scoped metadata, identify the strongest failure/cost/safety/context signal, and choose one minimal next action.',
    evidence,
    root_cause_candidates: rootCauseCandidates.filter(Boolean),
    recommendation,
    saved_view: savedView,
    alert_handoff: alertHandoff,
    recommendation_review: buildRecommendationReview(recommendation),
    proposed_action: recommendation?.next_action || 'Open Run Replay, run the starter KQL, then create or update one recommendation with evidence, validation, and rollback metadata.',
    validation: [
      ...(recommendation?.validation || []),
      `Re-run the starter KQL for ${context.last}.`,
      context.benchmark || recommendation?.benchmark_run_id
        ? `Re-run or review benchmark ${context.benchmark || recommendation.benchmark_run_id}.`
        : 'Run the relevant benchmark or dashboard query before promotion.',
      savedView?.url ? `Open saved view ${savedView.name || savedView.saved_view_id}.` : '',
      alertHandoff?.history_query ? `Review alert handoff KQL for ${alertHandoff.rule}.` : '',
      'Confirm no prompt, response, tool argument, tool result, source code, file content, or secret capture was enabled.'
    ].filter(Boolean),
    rollback_condition: recommendation?.rollback_condition || 'Rollback or reject the agent, skill, MCP, model, or instruction change if eval score drops, failures rise, cost increases unexpectedly, or privacy signals appear.'
  };
}

function renderList(items = []) {
  return items.length ? `<ul>${items.map(item => `<li>${htmlEscape(item)}</li>`).join('')}</ul>` : '<p>None.</p>';
}

function renderRecommendationEvidence(recommendation) {
  if (!recommendation) return '';
  const artifactFiles = [
    ...recommendation.benchmark_artifact_files,
    ...recommendation.benchmark_artifact_content_diff_files
  ].map(item => [item.task_id, item.change, item.path].filter(Boolean).join(' - '));
  return `<h3>Recommendation</h3>
      <p>${htmlEscape([recommendation.severity, recommendation.action, recommendation.recommendation_id].filter(Boolean).join(' / '))}</p>
      <p>${htmlEscape(recommendation.observed_pattern)}</p>
      <h4>Change targets</h4>
      ${renderList(recommendation.change_target_refs)}
      <h4>Benchmark</h4>
      ${renderList([recommendation.benchmark_run_id, recommendation.benchmark_decision].filter(Boolean))}
      <h4>Artifact files</h4>
      ${renderList(artifactFiles)}
      <h4>Metric movement</h4>
      ${renderMetricMovement(recommendation)}`;
}

function renderAnnotationRefs(annotations = []) {
  return renderList(annotations.map(annotation => [
    annotation.component,
    annotation.target,
    annotation.change_type,
    annotation.change_id,
    annotation.version
  ].filter(Boolean).join(' - ')));
}

function renderSavedViewEvidence(savedView) {
  if (!savedView) return '';
  return `<h3>Saved view</h3>
      <p>${htmlEscape([savedView.name, savedView.saved_view_id].filter(Boolean).join(' / '))}</p>
      ${savedView.url ? `<p><a href="${htmlEscape(savedView.url)}">Open saved view</a></p>` : ''}
      <h4>Query</h4>
      ${renderList([savedView.query_hash ? `query_hash=${savedView.query_hash}` : '', savedView.session_id ? `session=${savedView.session_id}` : ''].filter(Boolean))}
      <h4>Tags</h4>
      ${renderList(savedView.tags || [])}
      <h4>Change targets</h4>
      ${renderList(savedView.change_target_refs || [])}
      <h4>Config-change annotations</h4>
      ${renderAnnotationRefs(savedView.change_annotations || [])}`;
}

function renderAlertHandoffEvidence(handoff) {
  if (!handoff) return '';
  return `<h3>Alert handoff</h3>
      <p>${htmlEscape([handoff.rule, handoff.session, handoff.severity, handoff.owner, handoff.state].filter(Boolean).join(' / '))}</p>
      ${handoff.session_link?.grafana_url ? `<p><a href="${htmlEscape(handoff.session_link.grafana_url)}">Open alert session</a></p>` : ''}
      <h4>Alert queries</h4>
      ${renderList([handoff.history_query, handoff.config_change_query, handoff.config_change_count ? `config changes=${handoff.config_change_count}` : ''].filter(Boolean))}
      <h4>Config-change annotations</h4>
      ${renderAnnotationRefs(handoff.change_annotations || [])}
      <h4>Operator steps</h4>
      ${renderList(handoff.operator_steps || [])}
      <h4>Alert guardrails</h4>
      ${renderList(handoff.guardrails || [])}`;
}

function renderMetricMovement(recommendation = {}) {
  const metrics = Array.isArray(recommendation.expected_metric_movement?.metrics)
    ? recommendation.expected_metric_movement.metrics.map(item => [
      item.metric,
      item.expected_direction,
      item.current_value === undefined || item.current_value === null ? '' : `current=${item.current_value}`,
      item.baseline_value === undefined || item.baseline_value === null ? '' : `baseline=${item.baseline_value}`
    ].filter(Boolean).join(' - '))
    : [];
  const before = recommendation.before_telemetry || {};
  const after = recommendation.after_telemetry || {};
  const movementResults = Array.isArray(recommendation.observed_metric_movement?.results)
    ? recommendation.observed_metric_movement.results.map(item => [
      item.metric,
      item.expected_direction,
      item.before_value === undefined || item.before_value === null ? '' : `before=${item.before_value}`,
      item.after_value === undefined || item.after_value === null ? '' : `after=${item.after_value}`,
      item.delta === undefined || item.delta === null ? '' : `delta=${item.delta}`,
      item.passed === undefined ? '' : `passed=${item.passed}`
    ].filter(Boolean).join(' - '))
    : [];
  const beforeRows = [
    before.run_id ? `before run ${before.run_id}` : '',
    before.eval_overall === undefined || before.eval_overall === null ? '' : `eval=${before.eval_overall}`,
    before.estimated_cost_usd === undefined || before.estimated_cost_usd === null ? '' : `cost=${before.estimated_cost_usd}`,
    before.tool_failure_count === undefined || before.tool_failure_count === null ? '' : `tool failures=${before.tool_failure_count}`,
    before.risk_score === undefined || before.risk_score === null ? '' : `risk=${before.risk_score}`,
    after.run_id ? `after run ${after.run_id}` : '',
    after.eval_overall === undefined || after.eval_overall === null ? '' : `after eval=${after.eval_overall}`,
    after.estimated_cost_usd === undefined || after.estimated_cost_usd === null ? '' : `after cost=${after.estimated_cost_usd}`,
    after.tool_failure_count === undefined || after.tool_failure_count === null ? '' : `after tool failures=${after.tool_failure_count}`,
    after.risk_score === undefined || after.risk_score === null ? '' : `after risk=${after.risk_score}`,
    recommendation.observed_metric_movement?.status ? `status=${recommendation.observed_metric_movement.status}` : ''
  ].filter(Boolean);
  return `${renderList(metrics)}${renderList(beforeRows)}${renderList(movementResults)}`;
}

function renderRecommendationReview(review) {
  if (!review) return '';
  return `<h3>Guided review</h3>
      <p>${htmlEscape(`Default decision: ${review.default_decision}`)}</p>
      ${renderList(review.reasons)}
      <div class="review-box" data-review='${htmlEscape(JSON.stringify(review.shared_store.reviewed_row_template))}' data-post-path="${htmlEscape(review.shared_store.post_path)}">
        <p><code>${htmlEscape(review.action_plan_command)}</code></p>
        <label>Reviewer <input id="reviewer" autocomplete="off" placeholder="name or team"></label>
        <label>Note <textarea id="review-note" rows="3" placeholder="metadata-only review note"></textarea></label>
        <p>
          <button type="button" data-decision="approve">Approve</button>
          <button type="button" data-decision="reject">Reject</button>
        </p>
        <p class="note">Approval creates a metadata-only reviewed recommendation row. It does not edit files, change Azure resources, or route tickets.</p>
        <pre id="review-output">${htmlEscape(JSON.stringify(review.shared_store.reviewed_row_template, null, 2))}</pre>
      </div>
      <h4>Review guardrails</h4>
      ${renderList(review.guardrails)}`;
}

function renderAskAgentOpsLaunch(packet) {
  const launch = packet.launch_url
    ? `<p><a class="button" href="${htmlEscape(packet.launch_url)}">Open Assistant</a></p>`
    : '<p class="note">Set <code>AGENTOPS_ASSISTANT_URL</code> to enable a direct assistant launch URL. The metadata-only prompt is ready to copy.</p>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ask AgentOps</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, Segoe UI, sans-serif; }
    body { margin: 0; background: #f7f8fa; color: #1f2937; }
    main { max-width: 880px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    pre, .note { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    .button, button { display: inline-block; color: white; background: #2563eb; border: 0; border-radius: 6px; padding: 10px 14px; text-decoration: none; cursor: pointer; }
    button[data-decision="reject"] { background: #991b1b; }
    label { display: block; margin: 10px 0; font-weight: 600; }
    input, textarea { box-sizing: border-box; width: 100%; margin-top: 4px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; font: inherit; }
    ul { padding-left: 20px; }
    li { margin: 6px 0; }
    @media (prefers-color-scheme: dark) {
      body { background: #0b1020; color: #e5e7eb; }
      pre, .note { background: #111827; border-color: #374151; }
      input, textarea { background: #0b1020; color: #e5e7eb; border-color: #374151; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Ask AgentOps</h1>
    <p class="note">Metadata-only assistant context for ${htmlEscape(packet.run_id || packet.session_id || packet.trace_id || 'selected run')}.</p>
    ${packet.status === 'ready' ? launch : `<p class="note">${htmlEscape(packet.errors.join('; '))}</p>`}
    ${packet.assistant_response ? `<section class="note">
      <h2>Response Draft</h2>
      <p>${htmlEscape(packet.assistant_response.summary)}</p>
      <h3>Evidence</h3>
      <ul>${packet.assistant_response.evidence.map(item => `<li>${htmlEscape(item)}</li>`).join('')}</ul>
      <h3>Root-cause candidates</h3>
      <ul>${packet.assistant_response.root_cause_candidates.map(item => `<li>${htmlEscape(item)}</li>`).join('')}</ul>
      ${renderRecommendationEvidence(packet.assistant_response.recommendation)}
      ${renderSavedViewEvidence(packet.assistant_response.saved_view)}
      ${renderAlertHandoffEvidence(packet.assistant_response.alert_handoff)}
      <h3>Next action</h3>
      <p>${htmlEscape(packet.assistant_response.proposed_action)}</p>
      <h3>Validation</h3>
      <ul>${packet.assistant_response.validation.map(item => `<li>${htmlEscape(item)}</li>`).join('')}</ul>
      <h3>Rollback</h3>
      <p>${htmlEscape(packet.assistant_response.rollback_condition)}</p>
      ${renderRecommendationReview(packet.assistant_response.recommendation_review)}
    </section>` : ''}
    <pre>${htmlEscape(packet.prompt || JSON.stringify(packet.errors, null, 2))}</pre>
  </main>
  <script>
    const reviewBox = document.querySelector('.review-box');
    if (reviewBox) {
      const output = document.getElementById('review-output');
      const reviewer = document.getElementById('reviewer');
      const note = document.getElementById('review-note');
      const buildRow = decision => {
        const row = JSON.parse(reviewBox.dataset.review);
        row.OperatorReview = {
          ...row.OperatorReview,
          status: decision,
          decision,
          reviewer: reviewer.value.trim(),
          note: note.value.trim(),
          reviewed_at: new Date().toISOString(),
          source: 'ask-agentops-guided-review'
        };
        return row;
      };
      reviewBox.querySelectorAll('button[data-decision]').forEach(button => {
        button.addEventListener('click', async () => {
          const row = buildRow(button.dataset.decision);
          output.textContent = JSON.stringify(row, null, 2);
          try {
            const response = await fetch(reviewBox.dataset.postPath, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ row })
            });
            if (response.ok) output.textContent = JSON.stringify(await response.json(), null, 2);
          } catch {
            output.textContent = JSON.stringify(row, null, 2);
          }
        });
      });
    }
  </script>
</body>
</html>`;
}

function metadataFromPayload(payload = {}) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const essentials = data.essentials && typeof data.essentials === 'object' ? data.essentials : {};
  const customProperties = data.customProperties && typeof data.customProperties === 'object' ? data.customProperties : {};
  const context = data.alertContext && typeof data.alertContext === 'object' ? data.alertContext : {};
  const dimensions = Array.isArray(context.dimensions) ? context.dimensions : [];
  const dimensionMap = Object.fromEntries(dimensions
    .map(item => [stringValue(item.name || item.Name), stringValue(item.value || item.Value)])
    .filter(([name]) => name));

  return {
    rule: stringValue(customProperties['agentops.rule'] || customProperties.rule || dimensionMap.rule || essentials.alertRule || essentials.alertRuleName).trim(),
    session: stringValue(customProperties['agentops.session'] || customProperties.session || dimensionMap.session || dimensionMap.Conversation || dimensionMap.conversation).trim(),
    owner: stringValue(customProperties['agentops.owner'] || customProperties.owner || process.env.AGENTOPS_ACTIONER_OWNER).trim(),
    service: stringValue(customProperties['agentops.service'] || customProperties.service || process.env.AGENTOPS_ACTIONER_SERVICE || 'agentops').trim(),
    last: stringValue(customProperties['agentops.last'] || customProperties.last || process.env.AGENTOPS_ACTIONER_LOOKBACK || '24h').trim(),
    timezone: stringValue(customProperties['agentops.timezone'] || customProperties.timezone || process.env.AGENTOPS_ACTIONER_TIMEZONE || 'UTC').trim(),
    severity: stringValue(essentials.severity || customProperties.severity).trim(),
    monitor_condition: stringValue(essentials.monitorCondition).trim(),
    fired_at: stringValue(essentials.firedDateTime).trim()
  };
}

function buildActionerReview(payload = {}, options = {}) {
  const metadata = metadataFromPayload(payload);
  const errors = [];

  if (!alertRuleNames.has(metadata.rule)) {
    errors.push(`unknown or missing alert rule: ${metadata.rule || '<missing>'}`);
  }
  if (!metadata.session) errors.push('missing alert session/conversation id');

  const workspaceId = stringValue(options.workspaceId || process.env.AGENTOPS_WORKSPACE_ID || 'unknown');
  const alerts = createAlerts({
    workspaceId,
    baseFilter: 'Properties["agentops.signal"] == "true"',
    sessionKey: 'tostring(Properties["gen_ai.conversation.id"])',
    validateKqlDuration(value) {
      const text = stringValue(value || '24h').trim();
      if (!/^\d+[mhd]$/.test(text)) throw new Error(`invalid lookback: ${text}`);
      return text;
    },
    buildLink(conversation) {
      return {
        conversation,
        grafana_url: `${options.grafanaBaseUrl || 'https://grafana.example.invalid'}/d/agentops-session-detail?var-session_id=${encodeURIComponent(conversation)}`,
        azure_portal_url: `${options.azurePortalBaseUrl || 'https://portal.azure.com'}/#blade/Microsoft_Azure_Monitoring_Logs/LogsBlade`
      };
    }
  });

  const packet = {
    schema_version: 'agentops.actioner-review.v1',
    mode: 'metadata-only-actioner-review',
    status: errors.length ? 'needs-review' : 'ready',
    alert: {
      rule: metadata.rule || null,
      session: metadata.session || null,
      severity: metadata.severity || null,
      monitor_condition: metadata.monitor_condition || null,
      fired_at: metadata.fired_at || null,
      last: metadata.last
    },
    ownership: {
      owner: metadata.owner || null,
      service: metadata.service,
      timezone: metadata.timezone
    },
    errors,
    privacy: {
      mode: 'metadata-only',
      excluded: ['prompts', 'responses', 'tool arguments', 'tool results', 'file contents', 'raw alert payload']
    },
    guardrails: [
      'Do not page, post tickets, mutate Azure resources, or edit repositories from this actioner.',
      'Review the returned packet before routing any notification.',
      'Keep prompts, responses, tool arguments, tool results, and file contents out of incident systems.'
    ]
  };

  if (errors.length) return packet;

  const owners = metadata.owner ? [metadata.owner] : [];
  const detail = alerts.alertDetail({
    rule: metadata.rule,
    session: metadata.session,
    last: metadata.last
  });
  const actionPlan = alerts.alertActionPlan({
    rule: metadata.rule,
    session: metadata.session,
    last: metadata.last
  });
  const artifact = alerts.alertArtifact({
    rule: metadata.rule,
    session: metadata.session,
    last: metadata.last
  });
  const review = {
    schema_version: 'agentops.actioner-alert-review.v1',
    mode: 'metadata-only-actioner-alert-review',
    alert: {
      rule: metadata.rule,
      session: metadata.session,
      last: metadata.last
    },
    owner: metadata.owner || null,
    evidence: {
      detail,
      action_plan: actionPlan,
      artifact
    },
    commands: {
      detail: `agentops alert detail --rule ${metadata.rule} --session ${metadata.session} --last ${metadata.last}`,
      action_plan: actionPlan.next_command,
      handoff: `agentops alert handoff --rule ${metadata.rule} --session ${metadata.session}${metadata.owner ? ` --owner ${metadata.owner}` : ''} --last ${metadata.last}`
    }
  };
  const routePlan = owners.length
    ? alerts.alertRoutePlan({
      rule: metadata.rule,
      session: metadata.session,
      last: metadata.last,
      owners,
      service: metadata.service,
      timezone: metadata.timezone,
      targets: ['github-issue']
    })
    : null;

  return {
    ...packet,
    review,
    route_plan: routePlan,
    next: [
      'Open the run-scoped review links.',
      'Confirm owner and alert history evidence.',
      'Route a ticket manually or with an explicitly approved guarded CLI route command.'
    ]
  };
}

async function actioner(context, req) {
  try {
    const body = req && req.body && typeof req.body === 'object' ? req.body : {};
    const packet = buildActionerReview(body);
    context.res = {
      status: packet.status === 'ready' ? 200 : 202,
      headers: { 'Content-Type': 'application/json' },
      body: packet
    };
  } catch (error) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: {
        schema_version: 'agentops.actioner-review.v1',
        mode: 'metadata-only-actioner-review',
        status: 'invalid',
        error: error.message
      }
    };
  }
}

async function sharedStoreWrite(context, req) {
  try {
    const body = req && req.body && typeof req.body === 'object' ? req.body : {};
    const params = req && req.params && typeof req.params === 'object' ? req.params : {};
    const packet = buildSharedStoreWrite({
      ...body,
      table: body.table || params.table,
      id: body.id || params.id
    });
    if (packet.status === 'ready') {
      context.bindings.sharedBlob = packet.blob.content;
    }
    context.res = {
      status: packet.status === 'ready' ? 201 : 400,
      headers: { 'Content-Type': 'application/json' },
      body: packet
    };
  } catch (error) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: {
        schema_version: 'agentops.shared-store-write.v1',
        mode: 'metadata-only-shared-store-write',
        status: 'invalid',
        error: error.message
      }
    };
  }
}

async function sharedStoreEditor(context) {
  context.res = {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: buildSharedStoreEditor()
  };
}

async function askAgentOps(context, req) {
  const query = req && req.query && typeof req.query === 'object' ? req.query : {};
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const packet = buildAskAgentOpsLaunch({ ...query, ...body }, {
    sharedStoreBlobs: context?.bindings || {}
  });
  const wantsJson = stringValue(query.format || body.format).toLowerCase() === 'json'
    || stringValue(req?.headers?.accept).includes('application/json');
  context.res = {
    status: packet.status === 'ready' ? 200 : 400,
    headers: { 'Content-Type': wantsJson ? 'application/json' : 'text/html; charset=utf-8' },
    body: wantsJson ? packet : renderAskAgentOpsLaunch(packet)
  };
}

module.exports = actioner;
module.exports.askAgentOps = askAgentOps;
module.exports.buildActionerReview = buildActionerReview;
module.exports.buildAskAgentOpsLaunch = buildAskAgentOpsLaunch;
module.exports.buildAskAgentOpsResponse = buildAskAgentOpsResponse;
module.exports.buildRecommendationReview = buildRecommendationReview;
module.exports.buildSharedStoreEditor = buildSharedStoreEditor;
module.exports.buildSharedStoreWrite = buildSharedStoreWrite;
module.exports.metadataFromPayload = metadataFromPayload;
module.exports.sharedStoreEditor = sharedStoreEditor;
module.exports.sharedStoreWrite = sharedStoreWrite;
module.exports.validateSharedWriteRow = validateSharedWriteRow;
