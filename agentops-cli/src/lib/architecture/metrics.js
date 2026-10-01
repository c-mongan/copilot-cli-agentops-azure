const DEFAULTS = Object.freeze({
  minRuns: 10,
  wilsonZ: 1.959963984540054,
  thrashConsecutive: 3,
  thrashShareThreshold: 0.2,
  mechanicalModelCallsThreshold: 3,
  referenceNearMandatoryRate: 0.9,
  coactivationRate: 0.8,
  coactivationIndependentUseCeiling: 0.1,
  highReferenceLoadFloor: 1
});

function wilsonInterval(numerator, denominator, z = DEFAULTS.wilsonZ) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return { lower: 0, upper: 0 };
  }
  const n = denominator;
  const p = numerator / n;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p) / n) + (z2 / (4 * n * n)));
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

function proportionRow(numerator, denominator, coverageRuns, architectureVersion, extra = {}) {
  const sufficient = denominator >= DEFAULTS.minRuns;
  return {
    numerator,
    denominator,
    coverageRuns,
    architectureVersion,
    rate: denominator > 0 ? numerator / denominator : null,
    wilson: wilsonInterval(numerator, denominator),
    sufficient,
    status: sufficient ? 'eligible' : 'insufficient-evidence',
    ...extra
  };
}

function matchesArchitecture(graph, run) {
  // Unknown or partial capture cannot establish a metric denominator.
  return run.architectureVersion === graph.architectureVersion && run.evidenceComplete === true;
}

function eligibleRuns(graph, joinedRuns) {
  return joinedRuns.filter(run => matchesArchitecture(graph, run));
}

function skillActivationRate(graph, joinedRuns) {
  const covered = eligibleRuns(graph, joinedRuns);
  const perAgentCount = new Map();
  for (const run of covered) {
    for (const agent of run.agentsObserved) {
      perAgentCount.set(agent, (perAgentCount.get(agent) || 0) + 1);
    }
  }
  const rows = [];
  for (const skill of graph.skills) {
    for (const agent of graph.agents) {
      const agentDenominator = perAgentCount.get(agent.name) || 0;
      const activated = covered.filter(run => run.agentsObserved.has(agent.name) && run.skillsObserved.has(skill.name)).length;
      if (agentDenominator === 0 && activated === 0) continue;
      rows.push({
        agent: agent.name,
        skill: skill.name,
        ...proportionRow(activated, agentDenominator, covered.length, graph.architectureVersion)
      });
    }
  }
  return rows;
}

function skillCoactivation(graph, joinedRuns) {
  const covered = eligibleRuns(graph, joinedRuns);
  const names = graph.skills.map(skill => skill.name);
  const rows = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = names[i];
      const b = names[j];
      const runsWithA = covered.filter(run => run.skillsObserved.has(a));
      const runsWithB = covered.filter(run => run.skillsObserved.has(b));
      const runsWithBoth = covered.filter(run => run.skillsObserved.has(a) && run.skillsObserved.has(b));
      const representativeRunIds = runsWithBoth.slice(0, 5).map(run => run.runId);
      rows.push({
        skillA: a,
        skillB: b,
        pBGivenA: proportionRow(runsWithBoth.length, runsWithA.length, covered.length, graph.architectureVersion),
        pAGivenB: proportionRow(runsWithBoth.length, runsWithB.length, covered.length, graph.architectureVersion),
        representativeRunIds
      });
    }
  }
  return rows;
}

function independentUse(graph, joinedRuns) {
  const covered = eligibleRuns(graph, joinedRuns);
  const names = graph.skills.map(skill => skill.name);
  const rows = [];
  for (const target of names) {
    for (const anchor of names) {
      if (target === anchor) continue;
      const runsWithTarget = covered.filter(run => run.skillsObserved.has(target));
      const runsWithTargetWithoutAnchor = runsWithTarget.filter(run => !run.skillsObserved.has(anchor));
      if (runsWithTarget.length === 0) continue;
      rows.push({
        skill: target,
        otherSkill: anchor,
        ...proportionRow(runsWithTargetWithoutAnchor.length, runsWithTarget.length, covered.length, graph.architectureVersion)
      });
    }
  }
  return rows;
}

function referenceLoadGivenSkill(graph, joinedRuns) {
  const covered = eligibleRuns(graph, joinedRuns);
  const rows = [];
  for (const skill of graph.skills) {
    const runsWithSkill = covered.filter(run => run.skillsObserved.has(skill.name));
    for (const ref of skill.references) {
      const runsReadingRef = runsWithSkill.filter(run => {
        const refs = run.perSkillRefs.get(skill.name);
        return refs && refs.has(ref.path);
      });
      rows.push({
        skill: skill.name,
        reference: ref.path,
        ownerSkills: graph.referenceOwners.get(ref.path) || [skill.name],
        ambiguousOwnership: (graph.referenceOwners.get(ref.path) || []).length > 1,
        representativeRunIds: runsReadingRef.slice(0, 5).map(run => run.runId),
        ...proportionRow(runsReadingRef.length, runsWithSkill.length, covered.length, graph.architectureVersion)
      });
    }
  }
  return rows;
}

function rereadRate(graph, joinedRuns) {
  const covered = eligibleRuns(graph, joinedRuns);
  const rows = [];
  const references = new Set();
  for (const skill of graph.skills) for (const ref of skill.references) references.add(ref.path);
  for (const refPath of references) {
    let totalReads = 0;
    let runsReading = 0;
    const representatives = [];
    for (const run of covered) {
      const reads = run.refsRead.filter(entry => entry.reference === refPath).length;
      if (reads > 0) {
        runsReading += 1;
        totalReads += reads;
        if (representatives.length < 5) representatives.push(run.runId);
      }
    }
    rows.push({
      reference: refPath,
      totalReads,
      runsReading,
      coverageRuns: covered.length,
      architectureVersion: graph.architectureVersion,
      rate: runsReading > 0 ? totalReads / runsReading : null,
      sufficient: runsReading >= DEFAULTS.minRuns,
      status: runsReading >= DEFAULTS.minRuns ? 'eligible' : 'insufficient-evidence',
      representativeRunIds: representatives
    });
  }
  return rows;
}

function maxConsecutiveSameTool(toolCalls) {
  let best = { count: 0, tool: null, confirmedByState: false };
  let runCount = 0;
  let runTool = null;
  let runStateRepeated = true;
  let lastState = null;
  let lastArgHash = null;
  for (const call of toolCalls) {
    if (call.eventName !== 'tool.execution_complete') continue;
    const sameTool = call.tool === runTool;
    const stateProgressed = call.resultState !== null && call.resultState !== undefined && call.resultState !== lastState;
    const argRepeated = call.argHash !== null && call.argHash === lastArgHash;
    const noStateProgress = call.resultState === null || call.resultState === undefined ? null : !stateProgressed;
    if (sameTool) {
      runCount += 1;
      if (noStateProgress === false) runStateRepeated = false;
    } else {
      runCount = 1;
      runTool = call.tool;
      runStateRepeated = true;
    }
    if (runCount > best.count) {
      const stateEvidence = runStateRepeated && (noStateProgress === true || argRepeated);
      best = {
        count: runCount,
        tool: runTool,
        confirmedByState: Boolean(stateEvidence && (noStateProgress === true))
      };
    }
    lastState = call.resultState === undefined ? null : call.resultState;
    lastArgHash = call.argHash === undefined ? null : call.argHash;
  }
  return best;
}

function toolRepetition(graph, joinedRuns) {
  const covered = eligibleRuns(graph, joinedRuns);
  const rows = [];
  const perTool = new Map();
  for (const run of covered) {
    const best = maxConsecutiveSameTool(run.toolCalls);
    if (best.tool) {
      if (!perTool.has(best.tool)) perTool.set(best.tool, { triggered: 0, confirmed: 0, representatives: [] });
      const entry = perTool.get(best.tool);
      if (best.count >= DEFAULTS.thrashConsecutive) {
        entry.triggered += 1;
        if (best.confirmedByState) entry.confirmed += 1;
        if (entry.representatives.length < 5) entry.representatives.push(run.runId);
      }
    }
  }
  for (const [tool, entry] of perTool) {
    rows.push({
      tool,
      ...proportionRow(entry.triggered, covered.length, covered.length, graph.architectureVersion, {
        confirmedByStateCount: entry.confirmed,
        representativeRunIds: entry.representatives
      })
    });
  }
  return rows;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

function scriptHealth(graph, joinedRuns) {
  const covered = eligibleRuns(graph, joinedRuns);
  const perScript = new Map();
  for (const run of covered) {
    for (const call of run.scriptCalls) {
      if (!perScript.has(call.script)) perScript.set(call.script, { calls: 0, failures: 0, durations: [], runs: new Set() });
      const entry = perScript.get(call.script);
      entry.calls += 1;
      if (call.status === 'failed') entry.failures += 1;
      if (Number.isFinite(call.durationMs)) entry.durations.push(call.durationMs);
      entry.runs.add(run.runId);
    }
  }
  const rows = [];
  for (const [script, entry] of perScript) {
    rows.push({
      script,
      calls: entry.calls,
      runs: entry.runs.size,
      failureRate: entry.calls > 0 ? entry.failures / entry.calls : null,
      p50DurationMs: percentile(entry.durations, 0.5),
      p95DurationMs: percentile(entry.durations, 0.95),
      coverageRuns: covered.length,
      architectureVersion: graph.architectureVersion
    });
  }
  return rows;
}

function subagentContribution(graph, joinedRuns) {
  const covered = eligibleRuns(graph, joinedRuns);
  const durationRuns = covered.filter(run => run.runTotals.durationMs !== null && run.subagentDurationMs.total !== null);
  const tokenRuns = covered.filter(run => [run.runTotals.input, run.runTotals.output, run.subagentTokens.input, run.subagentTokens.output].every(value => value !== null));
  const ratio = (part, total) => total > 0 ? part / total : null;
  return {
    perRun: covered.map(run => ({
      runId: run.runId,
      durationShare: durationRuns.includes(run) ? ratio(run.subagentDurationMs.total, run.runTotals.durationMs) : null,
      tokenShare: tokenRuns.includes(run) ? ratio(run.subagentTokens.input + run.subagentTokens.output, run.runTotals.input + run.runTotals.output) : null
    })),
    aggregate: {
      durationShare: ratio(durationRuns.reduce((sum, run) => sum + run.subagentDurationMs.total, 0), durationRuns.reduce((sum, run) => sum + run.runTotals.durationMs, 0)),
      tokenShare: ratio(tokenRuns.reduce((sum, run) => sum + run.subagentTokens.input + run.subagentTokens.output, 0), tokenRuns.reduce((sum, run) => sum + run.runTotals.input + run.runTotals.output, 0)),
      durationBasis: 'sum-of-event-durations-not-wall-time',
      usageCoverageRuns: tokenRuns.length,
      durationCoverageRuns: durationRuns.length,
      coverageRuns: covered.length,
      architectureVersion: graph.architectureVersion
    }
  };
}

function contextPressure(graph, joinedRuns, options = {}) {
  const covered = eligibleRuns(graph, joinedRuns);
  const refThreshold = Number.isFinite(options.referenceThreshold) ? options.referenceThreshold : 3;
  const runsWithCompaction = covered.filter(run => run.compactionObserved);
  const failuresGivenCompaction = runsWithCompaction.filter(run => run.outcomeFailed).length;
  const runsWithManyRefs = covered.filter(run => run.refsRead.length >= refThreshold);
  const compactionGivenManyRefs = runsWithManyRefs.filter(run => run.compactionObserved).length;
  return {
    pFailureGivenCompaction: proportionRow(failuresGivenCompaction, runsWithCompaction.length, covered.length, graph.architectureVersion),
    pCompactionGivenManyRefs: proportionRow(compactionGivenManyRefs, runsWithManyRefs.length, covered.length, graph.architectureVersion, {
      referenceThreshold: refThreshold
    })
  };
}

function declaredVsObserved(graph, joinedRuns) {
  const covered = eligibleRuns(graph, joinedRuns);
  const notObserved = { agents: [], skills: [], references: [], scripts: [] };
  const observedAgents = new Set();
  const observedSkills = new Set();
  const observedRefs = new Set();
  const observedScripts = new Set();
  for (const run of covered) {
    for (const agent of run.agentsObserved) observedAgents.add(agent);
    for (const skill of run.skillsObserved) observedSkills.add(skill);
    for (const entry of run.refsRead) observedRefs.add(entry.reference);
    for (const call of run.scriptCalls) observedScripts.add(call.script);
  }
  if (covered.length >= DEFAULTS.minRuns) {
    for (const agent of graph.agents) if (!observedAgents.has(agent.name)) notObserved.agents.push({ name: agent.name, path: agent.path });
    for (const skill of graph.skills) if (!observedSkills.has(skill.name)) notObserved.skills.push({ name: skill.name, path: skill.path });
    for (const skill of graph.skills) for (const ref of skill.references) {
      if (!observedRefs.has(ref.path)) notObserved.references.push({ path: ref.path, ownerSkill: skill.name });
    }
    for (const script of graph.runtimeScripts) if (!observedScripts.has(script.path)) notObserved.scripts.push({ path: script.path, ownerSkills: script.ownerSkills });
  }
  const observedButUndeclared = { references: [] };
  const declaredRefs = new Set();
  for (const skill of graph.skills) for (const ref of skill.references) declaredRefs.add(ref.path);
  for (const refPath of observedRefs) {
    if (!declaredRefs.has(refPath) && /\/references\//.test(refPath)) {
      observedButUndeclared.references.push({ path: refPath });
    }
  }
  return {
    coverageRuns: covered.length,
    architectureVersion: graph.architectureVersion,
    sufficient: covered.length >= DEFAULTS.minRuns,
    notObserved,
    observedButUndeclared
  };
}

function computeAllMetrics(graph, joinedRuns, options = {}) {
  return {
    coverageRuns: eligibleRuns(graph, joinedRuns).length,
    architectureVersion: graph.architectureVersion,
    skillActivationRate: skillActivationRate(graph, joinedRuns),
    skillCoactivation: skillCoactivation(graph, joinedRuns),
    independentUse: independentUse(graph, joinedRuns),
    referenceLoadGivenSkill: referenceLoadGivenSkill(graph, joinedRuns),
    rereadRate: rereadRate(graph, joinedRuns),
    toolRepetition: toolRepetition(graph, joinedRuns),
    scriptHealth: scriptHealth(graph, joinedRuns),
    subagentContribution: subagentContribution(graph, joinedRuns),
    contextPressure: contextPressure(graph, joinedRuns, options),
    declaredVsObserved: declaredVsObserved(graph, joinedRuns)
  };
}

module.exports = {
  DEFAULTS,
  computeAllMetrics,
  contextPressure,
  declaredVsObserved,
  eligibleRuns,
  independentUse,
  maxConsecutiveSameTool,
  proportionRow,
  referenceLoadGivenSkill,
  rereadRate,
  scriptHealth,
  skillActivationRate,
  skillCoactivation,
  subagentContribution,
  toolRepetition,
  wilsonInterval
};
