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

function normalizeEvent(row = {}) {
  if (!row || typeof row !== 'object') return null;
  const eventName = String(row.EventName || row.event_name || '').trim();
  if (!eventName) return null;
  return {
    EventId: String(row.EventId || ''),
    Sequence: Number.isFinite(Number(row.Sequence)) ? Number(row.Sequence) : null,
    EventName: eventName,
    SpanName: String(row.SpanName || eventName),
    Status: String(row.Status || 'observed'),
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
    DurationMs: Number.isFinite(Number(row.DurationMs)) ? Number(row.DurationMs) : 0,
    InputTokens: Number.isFinite(Number(row.InputTokens)) ? Number(row.InputTokens) : 0,
    OutputTokens: Number.isFinite(Number(row.OutputTokens)) ? Number(row.OutputTokens) : 0,
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
  const subagentTokens = { input: 0, output: 0 };
  const subagentDurationMs = { total: 0 };
  const runTotals = { input: 0, output: 0, durationMs: 0 };
  let compaction = false;

  const lastSkillByAgent = new Map();
  const isSubagent = event => Boolean(event.ParentAgentId) || Boolean(event.SubAgentName);

  for (const event of dedupedEvents) {
    runTotals.input += event.InputTokens;
    runTotals.output += event.OutputTokens;
    runTotals.durationMs += event.DurationMs;
    if (event.ContextCompaction) compaction = true;
    if (event.AgentName) {
      agentsObserved.add(event.AgentName);
      if (isSubagent(event)) {
        subagentTokens.input += event.InputTokens;
        subagentTokens.output += event.OutputTokens;
        subagentDurationMs.total += event.DurationMs;
      }
    }
    if (event.SkillName) {
      if (!skillsObserved.has(event.SkillName)) skillActivationOrder.push(event.SkillName);
      skillsObserved.add(event.SkillName);
      if (event.AgentId) lastSkillByAgent.set(event.AgentId, event.SkillName);
    }
    if (event.ReferenceName) {
      const owningSkill = event.SkillName || lastSkillByAgent.get(event.AgentId) || null;
      refsRead.push({ reference: event.ReferenceName, afterSkill: owningSkill });
      if (owningSkill) {
        if (!perSkillRefs.has(owningSkill)) perSkillRefs.set(owningSkill, new Set());
        perSkillRefs.get(owningSkill).add(event.ReferenceName);
      }
    }
    if (event.ScriptName) {
      scriptCalls.push({
        script: event.ScriptName,
        skill: event.SkillName || lastSkillByAgent.get(event.AgentId) || null,
        status: event.Status,
        durationMs: event.DurationMs
      });
    }
    if (event.ToolName && (event.EventName === 'tool.execution_start' || event.EventName === 'tool.execution_complete')) {
      toolCalls.push({
        tool: event.ToolName,
        toolCallId: event.ToolCallId,
        status: event.Status,
        resultState: event.ResultState,
        argHash: event.ArgHash,
        eventName: event.EventName
      });
    }
    if (event.EventName === 'assistant.turn_end' || event.EventName === 'model.response' || event.EventName === 'assistant.message') {
      const skillKey = event.SkillName || lastSkillByAgent.get(event.AgentId) || '__no_skill__';
      modelCallsBySkill.set(skillKey, (modelCallsBySkill.get(skillKey) || 0) + 1);
    }
  }

  return {
    runId: run.runId,
    architectureVersion: run.architectureVersion || graph.architectureVersion,
    // Finding 2 (overnight whole-branch review): a genuinely missing/unknown
    // evidenceComplete signal must NOT be treated as "complete" — only an
    // explicit `true` (itself derived upstream from an affirmative, observable
    // capture signal, e.g. non-empty events) counts.
    evidenceComplete: run.evidenceComplete === true,
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
  sha256Hex
};
