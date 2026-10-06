const crypto = require('node:crypto');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sortedByPath(items = []) {
  return [...items].sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
}

function componentPairs(architecture = {}) {
  const pairs = [];
  for (const agent of sortedByPath(architecture.agents || [])) {
    pairs.push({ kind: 'agent', path: agent.path, sha256: agent.sha256 || '' });
  }
  for (const skill of sortedByPath(architecture.skills || [])) {
    pairs.push({ kind: 'skill', path: skill.path, sha256: skill.sha256 || '' });
    for (const ref of sortedByPath(skill.references || [])) {
      pairs.push({ kind: 'reference', path: ref.path, sha256: ref.sha256 || '', ownerSkillPath: skill.path });
    }
    for (const script of sortedByPath(skill.scripts || [])) {
      pairs.push({ kind: 'script', path: script.path, sha256: script.sha256 || '', ownerSkillPath: skill.path });
    }
  }
  for (const script of sortedByPath(architecture.runtimeScripts || [])) {
    if (!pairs.some(entry => entry.kind === 'script' && entry.path === script.path)) {
      pairs.push({ kind: 'runtimeScript', path: script.path, sha256: script.sha256 || '' });
    }
  }
  return pairs;
}

function architectureVersion(architecture = {}) {
  // Hash input is restricted to exactly (path, sha256) pairs per the binding
  // plan ruling, sorted by path then sha256 for a stable total order.
  // `kind` (and ownerSkillPath) stay on componentPairs() for other internal
  // ownership logic, but must not leak into the hashed bytes.
  const lines = componentPairs(architecture)
    .map(entry => ({ path: entry.path, sha256: entry.sha256 }))
    .sort((a, b) => {
      const byPath = String(a.path || '').localeCompare(String(b.path || ''));
      if (byPath !== 0) return byPath;
      return String(a.sha256 || '').localeCompare(String(b.sha256 || ''));
    })
    .map(entry => `${entry.path}\t${entry.sha256}`);
  return sha256Hex(lines.join('\n'));
}

function buildStaticGraph(architecture = {}) {
  const agents = (architecture.agents || []).map(agent => ({
    kind: 'agent',
    name: agent.name,
    path: agent.path,
    sha256: agent.sha256 || ''
  }));
  const skills = (architecture.skills || []).map(skill => ({
    kind: 'skill',
    name: skill.name,
    path: skill.path,
    sha256: skill.sha256 || '',
    references: (skill.references || []).map(ref => ({ path: ref.path, sha256: ref.sha256 || '' })),
    scripts: (skill.scripts || []).map(script => ({ path: script.path, sha256: script.sha256 || '' }))
  }));
  const referenceOwners = new Map();
  for (const skill of skills) {
    for (const ref of skill.references) {
      if (!referenceOwners.has(ref.path)) referenceOwners.set(ref.path, []);
      referenceOwners.get(ref.path).push(skill.name);
    }
  }
  const scriptOwners = new Map();
  for (const skill of skills) {
    for (const script of skill.scripts) {
      if (!scriptOwners.has(script.path)) scriptOwners.set(script.path, []);
      scriptOwners.get(script.path).push(skill.name);
    }
  }
  const runtimeScripts = (architecture.runtimeScripts || []).map(script => ({
    path: script.path,
    sha256: script.sha256 || '',
    ownerSkills: scriptOwners.get(script.path) || []
  }));
  return {
    agents,
    skills,
    runtimeScripts,
    referenceOwners,
    scriptOwners,
    architectureVersion: architectureVersion(architecture)
  };
}

function measurement(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function textOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function receiptConfigurationVersions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return [...new Set([value.configurationVersion, value.executionConfigurationHash]
    .filter(candidate => typeof candidate === 'string' && /^[a-f0-9]{16,64}$/.test(candidate)))].sort();
}

function normalizeExecutionConfiguration(value) {
  const source = ['observed_launch_arguments', 'supplied_identity', 'unknown'].includes(value?.source) ? value.source : 'unknown';
  const verification = ['locally_derived_from_arguments', 'caller_asserted', 'unknown'].includes(value?.verification) ? value.verification : 'unknown';
  const completeness = ['partial', 'authoritative', 'unknown'].includes(value?.completeness) ? value.completeness : 'unknown';
  const scope = {};
  for (const component of ['model', 'tools', 'mcp', 'skills']) {
    const state = value?.scope?.[component];
    scope[component] = ['authoritative', 'observed', 'unknown'].includes(state) ? state : 'unknown';
  }
  const hashAlgorithm = ['sha256-16', 'sha256', 'sha256-64'].includes(value?.hashAlgorithm) ? value.hashAlgorithm : null;
  const receiptVersions = receiptConfigurationVersions(value);
  return {
    schemaVersion: value?.schemaVersion === 1 ? 1 : null,
    hashAlgorithm,
    configurationVersion: receiptVersions.length === 1 ? receiptVersions[0] : null,
    source,
    verification,
    completeness,
    scope
  };
}

function affirmativeReferenceRead(event) {
  if (!event.ReferenceName) return false;
  const eventName = event.EventName.toLowerCase();
  const status = event.StatusRecorded ? event.Status.toLowerCase() : null;
  if (eventName === 'tool.execution_start') return false;
  if (['failed', 'error', 'partial', 'started', 'pending', 'cancelled', 'canceled', 'ambiguous', 'unknown', 'unobserved'].includes(status)) return false;
  if (eventName === 'tool.execution_complete') {
    // Old fixture rows did not carry Status. The event name itself was their
    // terminal success signal; retain that compatibility without accepting an
    // explicitly non-terminal or failed lifecycle state.
    return status === null || ['completed', 'complete', 'success', 'succeeded', 'ok', 'passed'].includes(status);
  }
  if (!['skill.context_delivered_ref', 'reference.read'].includes(eventName)) return false;
  if (status !== null && !['completed', 'complete', 'success', 'succeeded', 'ok', 'passed', 'observed'].includes(status)) return false;
  // Legacy reference events predate lifecycle fields. Their event type is the
  // affirmative read/delivery receipt, so they remain eligible.
  return true;
}

function normalizeEvent(row = {}) {
  if (!row || typeof row !== 'object') return null;
  const eventName = String(row.EventName || row.event_name || '').trim();
  if (!eventName) return null;
  return {
    EventId: String(row.EventId || ''),
    ParentEventId: String(row.ParentEventId || ''),
    TimeGenerated: textOrNull(row.TimeGenerated || row.time_generated || row.timestamp),
    Source: textOrNull(row.Source || row.source || row.Surface || row.surface),
    Surface: textOrNull(row.Surface || row.surface),
    SchemaVersion: textOrNull(row.SchemaVersion || row.schema_version),
    ConfigurationVersion: textOrNull(row.ConfigurationVersion || row.configurationVersion || row.configuration_version),
    TaskId: textOrNull(row.TaskId || row.taskId || row.task_id),
    RunId: String(row.RunId || ''),
    SessionId: String(row.SessionId || ''),
    TraceId: String(row.TraceId || ''),
    Sequence: Number.isFinite(Number(row.Sequence)) ? Number(row.Sequence) : null,
    EventName: eventName,
    SpanName: String(row.SpanName || eventName),
    Status: String(row.Status || 'observed'),
    StatusRecorded: row.Status !== undefined && row.Status !== null && row.Status !== '',
    AgentId: String(row.AgentId || ''),
    AgentName: String(row.AgentName || ''),
    ParentAgentId: String(row.ParentAgentId || ''),
    ParentToolCallId: String(row.ParentToolCallId || ''),
    SubAgentName: String(row.SubAgentName || ''),
    SkillName: String(row.SkillName || ''),
    ReferenceName: String(row.ReferenceName || ''),
    ScriptName: String(row.ScriptName || ''),
    ToolName: String(row.ToolName || ''),
    ToolCallId: String(row.ToolCallId || ''),
    DurationMs: measurement(row.DurationMs),
    InputTokens: measurement(row.InputTokens),
    OutputTokens: measurement(row.OutputTokens),
    ResultState: row.ResultState === undefined ? null : row.ResultState,
    ArgHash: row.ArgHash === undefined || row.ArgHash === null ? null : String(row.ArgHash),
    ContextCompaction: row.ContextCompaction === true || row.EventName === 'session.compaction',
    ReferenceLoadedWithSkill: row.ReferenceLoadedWithSkill === undefined ? null : Boolean(row.ReferenceLoadedWithSkill)
  };
}

function joinObserved(graph, run = {}) {
  const events = (run.events || []).map(normalizeEvent).filter(Boolean);
  const seenEventIds = new Set();
  const dedupedEvents = [];
  let duplicateDeliveries = 0;
  for (const event of events) {
    const key = event.EventId || `${event.EventName}:${event.Sequence}:${event.AgentId}:${event.ToolCallId}`;
    if (seenEventIds.has(key)) {
      duplicateDeliveries += 1;
      continue;
    }
    seenEventIds.add(key);
    dedupedEvents.push(event);
  }
  dedupedEvents.sort((a, b) => (a.Sequence ?? 0) - (b.Sequence ?? 0));

  const agentsObserved = new Set();
  const skillsObserved = new Set();
  const refsRead = [];
  const scriptCalls = [];
  const toolCalls = [];
  const modelCallsBySkill = new Map();
  const skillActivationOrder = [];
  const perSkillRefs = new Map();
  const seenReferenceReads = new Set();
  const subagentTokens = { input: 0, output: 0 };
  const subagentDurationMs = { total: 0 };
  const runTotals = { input: 0, output: 0, durationMs: 0 };
  let compaction = false;

  const lastSkillByAgent = new Map();
  const isSubagent = event => Boolean(event.ParentAgentId) || Boolean(event.SubAgentName);

  for (const event of dedupedEvents) {
    runTotals.input = runTotals.input === null || event.InputTokens === null ? null : runTotals.input + event.InputTokens;
    runTotals.output = runTotals.output === null || event.OutputTokens === null ? null : runTotals.output + event.OutputTokens;
    runTotals.durationMs = runTotals.durationMs === null || event.DurationMs === null ? null : runTotals.durationMs + event.DurationMs;
    if (event.ContextCompaction) compaction = true;
    if (event.AgentName) {
      agentsObserved.add(event.AgentName);
      if (isSubagent(event)) {
        subagentTokens.input = subagentTokens.input === null || event.InputTokens === null ? null : subagentTokens.input + event.InputTokens;
        subagentTokens.output = subagentTokens.output === null || event.OutputTokens === null ? null : subagentTokens.output + event.OutputTokens;
        subagentDurationMs.total = subagentDurationMs.total === null || event.DurationMs === null ? null : subagentDurationMs.total + event.DurationMs;
      }
    }
    if (event.SkillName) {
      if (!skillsObserved.has(event.SkillName)) skillActivationOrder.push(event.SkillName);
      skillsObserved.add(event.SkillName);
      if (event.AgentId) lastSkillByAgent.set(event.AgentId, event.SkillName);
    }
    if (affirmativeReferenceRead(event)) {
      const readKey = event.ToolCallId || event.EventId || `${event.ReferenceName}:${event.Sequence}`;
      if (!seenReferenceReads.has(readKey)) {
        seenReferenceReads.add(readKey);
        const owningSkill = event.SkillName || lastSkillByAgent.get(event.AgentId) || null;
        refsRead.push({
          reference: event.ReferenceName,
          afterSkill: owningSkill,
          eventId: event.EventId || null,
          timeGenerated: event.TimeGenerated,
          source: event.Source
        });
        if (owningSkill) {
          if (!perSkillRefs.has(owningSkill)) perSkillRefs.set(owningSkill, new Set());
          perSkillRefs.get(owningSkill).add(event.ReferenceName);
        }
      }
    }
    if (event.ScriptName) {
      scriptCalls.push({
        script: event.ScriptName,
        skill: event.SkillName || lastSkillByAgent.get(event.AgentId) || null,
        status: event.Status,
        durationMs: event.DurationMs,
        eventId: event.EventId || null
      });
    }
    if (event.ToolName && (event.EventName === 'tool.execution_start' || event.EventName === 'tool.execution_complete')) {
      toolCalls.push({
        tool: event.ToolName,
        toolCallId: event.ToolCallId,
        status: event.Status,
        resultState: event.ResultState,
        argHash: event.ArgHash,
        eventName: event.EventName,
        eventId: event.EventId || null
      });
    }
    if (event.EventName === 'assistant.turn_end' || event.EventName === 'model.response' || event.EventName === 'assistant.message') {
      const skillKey = event.SkillName || lastSkillByAgent.get(event.AgentId) || '__no_skill__';
      modelCallsBySkill.set(skillKey, (modelCallsBySkill.get(skillKey) || 0) + 1);
    }
  }

  const eventConfigurationVersions = [...new Set(dedupedEvents.map(event => event.ConfigurationVersion).filter(Boolean))];
  const recordedConfigurationVersion = textOrNull(run.configurationVersion);
  const receiptVersions = receiptConfigurationVersions(run.executionConfiguration);
  const eventTaskIds = [...new Set(dedupedEvents.map(event => event.TaskId).filter(Boolean))];
  const recordedTaskId = textOrNull(run.taskId) || textOrNull(run.taskContract?.taskId);
  const configurationVersions = [...new Set([recordedConfigurationVersion, ...receiptVersions, ...eventConfigurationVersions].filter(Boolean))].sort();
  const taskIds = [...new Set([recordedTaskId, ...eventTaskIds].filter(Boolean))].sort();
  return {
    runId: run.runId,
    evidenceOrigin: run.evidenceOrigin || null,
    architectureVersion: run.architectureVersion || graph.architectureVersion,
    configurationVersion: configurationVersions.length === 1 ? configurationVersions[0] : null,
    configurationVersions,
    executionConfiguration: normalizeExecutionConfiguration(run.executionConfiguration),
    taskId: taskIds.length === 1 ? taskIds[0] : null,
    taskIds,
    // Finding 2 (overnight whole-branch review): a genuinely missing/unknown
    // evidenceComplete signal must NOT be treated as "complete" — only an
    // explicit completeness assertion with valid captured rows counts.
    evidenceComplete: run.evidenceComplete === true,
    coverage: run.coverage || {},
    preRunSnapshot: run.preRunSnapshot || null,
    attachmentProvenance: run.attachmentProvenance || null,
    sourceIntegrity: run.sourceIntegrity || null,
    invalidSourceRows: run.invalidSourceRows || 0,
    componentDenominators: run.componentDenominators || {},
    lifecycle: run.lifecycle || null,
    taskContract: run.taskContract || null,
    outcomeFailed: Boolean(run.outcomeFailed),
    compactionObserved: compaction || Boolean(run.compactionObserved),
    duplicateDeliveries,
    events: dedupedEvents,
    agentsObserved,
    skillsObserved,
    skillActivationOrder,
    refsRead,
    perSkillRefs,
    scriptCalls,
    observedScriptReceipts: run.observedScriptReceipts || [],
    toolCalls,
    modelCallsBySkill,
    runTotals,
    subagentTokens,
    subagentDurationMs
  };
}

function joinLedger(graph, runs = []) {
  const joined = [];
  const invalid = [];
  for (const run of runs) {
    if (!run || !run.runId || !Array.isArray(run.events)) {
      invalid.push({ reason: 'missing-fields', runId: run?.runId || null });
      continue;
    }
    joined.push(joinObserved(graph, run));
  }
  return { joined, invalid };
}

module.exports = {
  architectureVersion,
  buildStaticGraph,
  componentPairs,
  joinLedger,
  joinObserved,
  normalizeEvent,
  normalizeExecutionConfiguration,
  sha256Hex
};
