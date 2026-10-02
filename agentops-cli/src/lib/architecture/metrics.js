const crypto = require('node:crypto');

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

function executionConfigurationEvidence(runs) {
  const configurations = runs.map(run => run.executionConfiguration || {});
  const values = (field, fallback = 'unknown') => [...new Set(configurations.map(configuration => configuration[field] || fallback))].sort();
  const completenessValues = values('completeness');
  const sources = values('source');
  const verificationValues = values('verification');
  const hashAlgorithms = [...new Set(configurations.map(configuration => configuration.hashAlgorithm).filter(Boolean))].sort();
  const scope = {};
  for (const component of ['model', 'tools', 'mcp', 'skills']) {
    const states = [...new Set(configurations.map(configuration => configuration.scope?.[component] || 'unknown'))].sort();
    scope[component] = states.length === 0 ? 'unknown' : states.length === 1 ? states[0] : 'mixed';
  }
  return {
    completeness: completenessValues.length === 1 ? completenessValues[0] : completenessValues.length > 1 ? 'mixed' : 'unknown',
    completenessValues,
    source: sources.length === 1 ? sources[0] : sources.length > 1 ? 'mixed' : 'unknown',
    sources,
    verification: verificationValues.length === 1 ? verificationValues[0] : verificationValues.length > 1 ? 'mixed' : 'unknown',
    verificationValues,
    hashAlgorithm: hashAlgorithms.length === 1 ? hashAlgorithms[0] : null,
    hashAlgorithms,
    scope
  };
}

function runCohort(run) {
  const configurationVersion = run.configurationVersion || null;
  const taskId = run.taskId || null;
  const configurationVersions = [...new Set((run.configurationVersions || []).filter(Boolean))].sort();
  const taskIds = [...new Set((run.taskIds || []).filter(Boolean))].sort();
  const configurationVersionStatus = configurationVersions.length > 1 ? 'mixed' : configurationVersion ? 'known' : 'unknown';
  const taskStatus = taskIds.length > 1 ? 'mixed' : taskId ? 'known' : 'unknown';
  const identity = {
    architectureVersion: run.architectureVersion || null,
    configurationVersion,
    configurationVersions,
    configurationVersionStatus,
    taskId,
    taskIds,
    taskStatus,
    executionConfiguration: run.executionConfiguration || null
  };
  return {
    ...identity,
    cohortId: crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  };
}

function eligibleCohorts(graph, joinedRuns) {
  const groups = new Map();
  for (const run of eligibleRuns(graph, joinedRuns)) {
    const cohort = runCohort(run);
    if (!groups.has(cohort.cohortId)) groups.set(cohort.cohortId, { ...cohort, runs: [] });
    groups.get(cohort.cohortId).runs.push(run);
  }
  return [...groups.values()]
    .map(cohort => ({ ...cohort, executionConfigurationEvidence: executionConfigurationEvidence(cohort.runs) }))
    .sort((a, b) => a.cohortId.localeCompare(b.cohortId));
}

function metricEligibleCohorts(graph, joinedRuns) {
  return eligibleCohorts(graph, joinedRuns).filter(cohort => (
    cohort.configurationVersionStatus !== 'mixed' && cohort.taskStatus !== 'mixed'
  ));
}

function metricEligibleRuns(graph, joinedRuns) {
  return metricEligibleCohorts(graph, joinedRuns).flatMap(cohort => cohort.runs);
}

function partitionedRows(graph, joinedRuns, options, calculate) {
  const cohorts = metricEligibleCohorts(graph, joinedRuns);
  if (options?.partition === false || cohorts.length <= 1) return null;
  return cohorts.flatMap(cohort => calculate(cohort.runs, { partition: false }));
}

function eventIds(runs, predicate = () => true) {
  return [...new Set(runs.flatMap(run => run.events
    .filter(predicate)
    .map(event => event.EventId)
    .filter(Boolean)))];
}

function evidenceMetadata(coverageRuns, evidenceIds, unit = 'runs') {
  const configurationVersions = [...new Set(coverageRuns.flatMap(run => {
    const versions = run.configurationVersions?.length ? run.configurationVersions : [run.configurationVersion];
    return versions.filter(Boolean);
  }))].sort();
  const hasUnknownConfiguration = coverageRuns.some(run => !run.configurationVersion || (run.configurationVersions || []).length > 1);
  const taskIds = [...new Set(coverageRuns.flatMap(run => {
    const ids = run.taskIds?.length ? run.taskIds : [run.taskId];
    return ids.filter(Boolean);
  }))].sort();
  const hasUnknownTask = coverageRuns.some(run => !run.taskId || (run.taskIds || []).length > 1);
  const configurationVersionStatus = configurationVersions.length > 1 || (configurationVersions.length > 0 && hasUnknownConfiguration)
    ? 'mixed'
    : configurationVersions.length === 1 ? 'known' : 'unknown';
  const taskStatus = taskIds.length > 1 || (taskIds.length > 0 && hasUnknownTask)
    ? 'mixed'
    : taskIds.length === 1 ? 'known' : 'unknown';
  const cohortIds = [...new Set(coverageRuns.map(run => runCohort(run).cohortId))];
  return {
    unit,
    configurationVersion: configurationVersionStatus === 'known' ? configurationVersions[0] : null,
    configurationVersions,
    taskId: taskStatus === 'known' ? taskIds[0] : null,
    taskIds,
    cohortId: cohortIds.length === 1 ? cohortIds[0] : null,
    executionConfigurationEvidence: executionConfigurationEvidence(coverageRuns),
    evidenceIds: [...new Set((evidenceIds || []).filter(Boolean))],
    coverage: {
      eligibleRuns: coverageRuns.length,
      evidenceCompleteRuns: coverageRuns.filter(run => run.evidenceComplete === true).length,
      configurationVersionStatus,
      taskStatus,
      runIds: coverageRuns.map(run => run.runId)
    }
  };
}

function skillActivationRate(graph, joinedRuns, options = {}) {
  const partitioned = partitionedRows(graph, joinedRuns, options, (runs, nested) => skillActivationRate(graph, runs, nested));
  if (partitioned) return partitioned;
  const covered = metricEligibleRuns(graph, joinedRuns);
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
      const denominatorRuns = covered.filter(run => run.agentsObserved.has(agent.name));
      const activatedRuns = denominatorRuns.filter(run => run.skillsObserved.has(skill.name));
      const activated = activatedRuns.length;
      if (agentDenominator === 0 && activated === 0) continue;
      rows.push({
        agent: agent.name,
        skill: skill.name,
        ...proportionRow(activated, agentDenominator, covered.length, graph.architectureVersion, evidenceMetadata(
          denominatorRuns,
          eventIds(activatedRuns, event => event.AgentName === agent.name && event.SkillName === skill.name)
        ))
      });
    }
  }
  return rows;
}

function skillCoactivation(graph, joinedRuns, options = {}) {
  const partitioned = partitionedRows(graph, joinedRuns, options, (runs, nested) => skillCoactivation(graph, runs, nested));
  if (partitioned) return partitioned;
  const covered = metricEligibleRuns(graph, joinedRuns);
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
        pBGivenA: proportionRow(runsWithBoth.length, runsWithA.length, covered.length, graph.architectureVersion, evidenceMetadata(
          runsWithA,
          eventIds(runsWithBoth, event => event.SkillName === a || event.SkillName === b)
        )),
        pAGivenB: proportionRow(runsWithBoth.length, runsWithB.length, covered.length, graph.architectureVersion, evidenceMetadata(
          runsWithB,
          eventIds(runsWithBoth, event => event.SkillName === a || event.SkillName === b)
        )),
        representativeRunIds
      });
    }
  }
  return rows;
}

function independentUse(graph, joinedRuns, options = {}) {
  const partitioned = partitionedRows(graph, joinedRuns, options, (runs, nested) => independentUse(graph, runs, nested));
  if (partitioned) return partitioned;
  const covered = metricEligibleRuns(graph, joinedRuns);
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
        ...proportionRow(runsWithTargetWithoutAnchor.length, runsWithTarget.length, covered.length, graph.architectureVersion, evidenceMetadata(
          runsWithTarget,
          eventIds(runsWithTargetWithoutAnchor, event => event.SkillName === target)
        ))
      });
    }
  }
  return rows;
}

function referenceLoadGivenSkill(graph, joinedRuns, options = {}) {
  const partitioned = partitionedRows(graph, joinedRuns, options, (runs, nested) => referenceLoadGivenSkill(graph, runs, nested));
  if (partitioned) return partitioned;
  const covered = metricEligibleRuns(graph, joinedRuns);
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
        ...proportionRow(runsReadingRef.length, runsWithSkill.length, covered.length, graph.architectureVersion, evidenceMetadata(
          runsWithSkill,
          runsReadingRef.flatMap(run => run.refsRead.filter(entry => entry.reference === ref.path).map(entry => entry.eventId))
        ))
      });
    }
  }
  return rows;
}

function rereadRate(graph, joinedRuns, options = {}) {
  const partitioned = partitionedRows(graph, joinedRuns, options, (runs, nested) => rereadRate(graph, runs, nested));
  if (partitioned) return partitioned;
  const covered = metricEligibleRuns(graph, joinedRuns);
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
      ...evidenceMetadata(
        covered,
        covered.flatMap(run => run.refsRead.filter(entry => entry.reference === refPath).map(entry => entry.eventId)),
        'reads-per-reading-run'
      ),
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

function toolRepetition(graph, joinedRuns, options = {}) {
  const partitioned = partitionedRows(graph, joinedRuns, options, (runs, nested) => toolRepetition(graph, runs, nested));
  if (partitioned) return partitioned;
  const covered = metricEligibleRuns(graph, joinedRuns);
  const rows = [];
  const perTool = new Map();
  for (const run of covered) {
    const best = maxConsecutiveSameTool(run.toolCalls);
    if (best.tool) {
      if (!perTool.has(best.tool)) perTool.set(best.tool, { triggered: 0, confirmed: 0, representatives: [], evidenceIds: [] });
      const entry = perTool.get(best.tool);
      if (best.count >= DEFAULTS.thrashConsecutive) {
        entry.triggered += 1;
        if (best.confirmedByState) entry.confirmed += 1;
        if (entry.representatives.length < 5) entry.representatives.push(run.runId);
        entry.evidenceIds.push(...run.toolCalls.filter(call => call.tool === best.tool && call.eventName === 'tool.execution_complete').map(call => call.eventId));
      }
    }
  }
  for (const [tool, entry] of perTool) {
    rows.push({
      tool,
      ...proportionRow(entry.triggered, covered.length, covered.length, graph.architectureVersion, {
        ...evidenceMetadata(covered, entry.evidenceIds),
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

function scriptHealth(graph, joinedRuns, options = {}) {
  const partitioned = partitionedRows(graph, joinedRuns, options, (runs, nested) => scriptHealth(graph, runs, nested));
  if (partitioned) return partitioned;
  const covered = metricEligibleRuns(graph, joinedRuns);
  const perScript = new Map();
  for (const run of covered) {
    for (const call of run.scriptCalls) {
      if (!perScript.has(call.script)) perScript.set(call.script, { calls: 0, failures: 0, durations: [], runs: new Set(), evidenceIds: [] });
      const entry = perScript.get(call.script);
      entry.calls += 1;
      if (call.status === 'failed') entry.failures += 1;
      if (Number.isFinite(call.durationMs)) entry.durations.push(call.durationMs);
      entry.runs.add(run.runId);
      if (call.eventId) entry.evidenceIds.push(call.eventId);
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
      architectureVersion: graph.architectureVersion,
      ...evidenceMetadata(covered, entry.evidenceIds, 'script-calls-and-milliseconds')
    });
  }
  return rows;
}

function subagentContribution(graph, joinedRuns, options = {}) {
  const cohorts = metricEligibleCohorts(graph, joinedRuns);
  if (options.partition !== false && cohorts.length > 1) {
    const results = cohorts.map(cohort => ({
      ...cohort,
      metrics: subagentContribution(graph, cohort.runs, { partition: false })
    }));
    const covered = metricEligibleRuns(graph, joinedRuns);
    return {
      perRun: results.flatMap(result => result.metrics.perRun),
      aggregate: {
        durationShare: null,
        tokenShare: null,
        durationBasis: 'partitioned-by-architecture-configuration-task-cohort',
        usageCoverageRuns: results.reduce((sum, result) => sum + result.metrics.aggregate.usageCoverageRuns, 0),
        durationCoverageRuns: results.reduce((sum, result) => sum + result.metrics.aggregate.durationCoverageRuns, 0),
        coverageRuns: covered.length,
        architectureVersion: graph.architectureVersion,
        ...evidenceMetadata(covered, eventIds(covered, event => Boolean(event.ParentAgentId) || Boolean(event.SubAgentName)), 'ratio'),
        status: 'partitioned'
      },
      cohorts: results.map(result => ({
        cohortId: result.cohortId,
        configurationVersion: result.configurationVersion,
        taskId: result.taskId,
        ...result.metrics
      }))
    };
  }
  const covered = metricEligibleRuns(graph, joinedRuns);
  const durationRuns = covered.filter(run => run.runTotals.durationMs !== null && run.subagentDurationMs.total !== null);
  const tokenRuns = covered.filter(run => [run.runTotals.input, run.runTotals.output, run.subagentTokens.input, run.subagentTokens.output].every(value => value !== null));
  const ratio = (part, total) => total > 0 ? part / total : null;
  return {
    perRun: covered.map(run => ({
      runId: run.runId,
      architectureVersion: run.architectureVersion,
      configurationVersion: run.configurationVersion,
      unit: 'ratio',
      evidenceIds: eventIds([run], event => Boolean(event.ParentAgentId) || Boolean(event.SubAgentName)),
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
      architectureVersion: graph.architectureVersion,
      ...evidenceMetadata(covered, eventIds(covered, event => Boolean(event.ParentAgentId) || Boolean(event.SubAgentName)), 'ratio')
    }
  };
}

function contextPressure(graph, joinedRuns, options = {}) {
  const cohorts = metricEligibleCohorts(graph, joinedRuns);
  if (options.partition !== false && cohorts.length > 1) {
    const covered = metricEligibleRuns(graph, joinedRuns);
    const metadata = evidenceMetadata(covered, eventIds(covered, event => event.ContextCompaction));
    const unavailable = {
      numerator: null,
      denominator: null,
      coverageRuns: covered.length,
      architectureVersion: graph.architectureVersion,
      rate: null,
      wilson: null,
      sufficient: false,
      status: 'partitioned',
      ...metadata
    };
    return {
      pFailureGivenCompaction: unavailable,
      pCompactionGivenManyRefs: { ...unavailable, referenceThreshold: Number.isFinite(options.referenceThreshold) ? options.referenceThreshold : 3 },
      cohorts: cohorts.map(cohort => ({
        cohortId: cohort.cohortId,
        configurationVersion: cohort.configurationVersion,
        taskId: cohort.taskId,
        metrics: contextPressure(graph, cohort.runs, { ...options, partition: false })
      }))
    };
  }
  const covered = metricEligibleRuns(graph, joinedRuns);
  const refThreshold = Number.isFinite(options.referenceThreshold) ? options.referenceThreshold : 3;
  const runsWithCompaction = covered.filter(run => run.compactionObserved);
  const failuresGivenCompaction = runsWithCompaction.filter(run => run.outcomeFailed).length;
  const runsWithManyRefs = covered.filter(run => run.refsRead.length >= refThreshold);
  const compactionGivenManyRefs = runsWithManyRefs.filter(run => run.compactionObserved).length;
  return {
    pFailureGivenCompaction: proportionRow(failuresGivenCompaction, runsWithCompaction.length, covered.length, graph.architectureVersion, evidenceMetadata(
      runsWithCompaction,
      eventIds(runsWithCompaction.filter(run => run.outcomeFailed), event => event.ContextCompaction)
    )),
    pCompactionGivenManyRefs: proportionRow(compactionGivenManyRefs, runsWithManyRefs.length, covered.length, graph.architectureVersion, {
      ...evidenceMetadata(runsWithManyRefs, eventIds(runsWithManyRefs.filter(run => run.compactionObserved), event => event.ContextCompaction)),
      referenceThreshold: refThreshold
    })
  };
}

function declaredVsObserved(graph, joinedRuns, options = {}) {
  const cohorts = metricEligibleCohorts(graph, joinedRuns);
  if (options.partition !== false && cohorts.length > 1) {
    const covered = metricEligibleRuns(graph, joinedRuns);
    const results = cohorts.map(cohort => ({
      cohortId: cohort.cohortId,
      configurationVersion: cohort.configurationVersion,
      taskId: cohort.taskId,
      ...declaredVsObserved(graph, cohort.runs, { partition: false })
    }));
    return {
      coverageRuns: covered.length,
      architectureVersion: graph.architectureVersion,
      ...evidenceMetadata(covered, eventIds(covered), 'observations'),
      sufficient: false,
      status: 'partitioned',
      notObserved: { agents: [], skills: [], references: [], scripts: [] },
      observedButUndeclared: { references: [] },
      cohorts: results
    };
  }
  const covered = metricEligibleRuns(graph, joinedRuns);
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
    ...evidenceMetadata(covered, eventIds(covered), 'observations'),
    sufficient: covered.length >= DEFAULTS.minRuns,
    notObserved,
    observedButUndeclared
  };
}

function computeAllMetrics(graph, joinedRuns, options = {}) {
  const observed = eligibleRuns(graph, joinedRuns);
  const covered = metricEligibleRuns(graph, joinedRuns);
  const cohorts = eligibleCohorts(graph, joinedRuns);
  const metadata = evidenceMetadata(observed, eventIds(observed), 'runs');
  return {
    coverageRuns: covered.length,
    observedCoverageRuns: observed.length,
    architectureVersion: graph.architectureVersion,
    ...metadata,
    coverage: {
      ...metadata.coverage,
      eligibleRuns: covered.length,
      observedRuns: observed.length,
      excludedMixedIdentityRuns: observed.length - covered.length
    },
    cohorts: cohorts.map(cohort => ({
      cohortId: cohort.cohortId,
      architectureVersion: cohort.architectureVersion,
      configurationVersion: cohort.configurationVersion,
      configurationVersions: cohort.configurationVersions,
      configurationVersionStatus: cohort.configurationVersionStatus,
      taskId: cohort.taskId,
      taskIds: cohort.taskIds,
      taskStatus: cohort.taskStatus,
      executionConfigurationEvidence: cohort.executionConfigurationEvidence,
      eligibleForMetrics: cohort.configurationVersionStatus !== 'mixed' && cohort.taskStatus !== 'mixed',
      exclusionReason: cohort.configurationVersionStatus === 'mixed' || cohort.taskStatus === 'mixed'
        ? 'conflicting configuration or task identity within a run'
        : null,
      coverageRuns: cohort.runs.length,
      runIds: cohort.runs.map(run => run.runId)
    })),
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
  evidenceMetadata,
  executionConfigurationEvidence,
  eligibleCohorts,
  eligibleRuns,
  eventIds,
  independentUse,
  maxConsecutiveSameTool,
  metricEligibleCohorts,
  metricEligibleRuns,
  runCohort,
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
