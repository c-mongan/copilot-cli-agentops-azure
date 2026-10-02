const {
  DEFAULTS,
  computeAllMetrics,
  evidenceMetadata,
  eventIds,
  metricEligibleCohorts,
  metricEligibleRuns
} = require('./metrics');

const RULE_METADATA = Object.freeze({
  REFERENCE_NEAR_MANDATORY: {
    title: 'Reference is read almost every time its skill activates',
    proposedChange: 'Promote the essential control information from this reference into SKILL.md; keep detail in the reference file.',
    specSection: '§50'
  },
  SKILL_PAIR_COACTIVATED: {
    title: 'Two skills activate together almost every time',
    proposedChange: 'Investigate merging the two skills, or turning the secondary one into a reference loaded by the primary.',
    specSection: '§§48–49'
  },
  TOOL_THRASH: {
    title: 'Tool repeats without visible state progress',
    proposedChange: 'Batch the call behind a deterministic script, or add a clearer stopping instruction so the agent stops retrying.',
    specSection: '§§43, 51'
  },
  MECHANICAL_LLM_STEP: {
    title: 'Model calls appear where a deterministic script was declared',
    proposedChange: 'Replace the model-driven step with a direct call to the designated script; confirm with a Vally single-change experiment before refactoring.',
    specSection: '§51'
  },
  DECLARED_NOT_OBSERVED: {
    title: 'Declared component was never observed in the covered runs',
    proposedChange: 'Review whether this component is still needed. This signal alone is not grounds to drop it; attach the next observed run and recheck before any change.',
    specSection: '§39'
  }
});

let cardCounter = 0;
function nextCardId(rule, cohortId = null) {
  cardCounter += 1;
  return `${rule}_${cohortId ? cohortId.slice(0, 12) : 'cohort-unknown'}_${Date.now().toString(36)}_${cardCounter}`;
}

function hypothesisCard({ rule, componentRefs, metricEvidence, representativeRunIds, coverageLimits, proposedChange, rejectionTest = 'pending', status = 'open', subStatus = null, title = null, summary = null }) {
  return {
    id: nextCardId(rule, metricEvidence?.cohortId),
    rule,
    status,
    subStatus,
    title: title || RULE_METADATA[rule]?.title || rule,
    summary,
    componentRefs,
    metricEvidence,
    representativeRunIds: (representativeRunIds || []).slice(0, 5),
    coverageLimits,
    proposedChange: proposedChange || RULE_METADATA[rule]?.proposedChange,
    rejectionTest
  };
}

function metricContract(row = {}) {
  return {
    unit: row.unit || 'unknown',
    configurationVersion: row.configurationVersion || null,
    configurationVersions: row.configurationVersions || [],
    taskId: row.taskId || null,
    taskIds: row.taskIds || [],
    cohortId: row.cohortId || null,
    evidenceIds: row.evidenceIds || [],
    coverage: row.coverage || null
  };
}

function referenceNearMandatoryRule(graph, metrics) {
  const rows = metrics.referenceLoadGivenSkill || [];
  const cards = [];
  for (const row of rows) {
    if (!row.sufficient) continue;
    if (row.rate === null || row.rate < DEFAULTS.referenceNearMandatoryRate) continue;
    cards.push(hypothesisCard({
      rule: 'REFERENCE_NEAR_MANDATORY',
      summary: `Reference ${row.reference} is read in ${row.numerator}/${row.denominator} runs where skill ${row.skill} activated (${Math.round(row.rate * 100)}%).`,
      componentRefs: [
        { kind: 'skill', name: row.skill },
        { kind: 'reference', path: row.reference, ownerSkills: row.ownerSkills, ambiguousOwnership: row.ambiguousOwnership }
      ],
      metricEvidence: {
        ...metricContract(row),
        numerator: row.numerator,
        denominator: row.denominator,
        coverageRuns: row.coverageRuns,
        interval: row.wilson,
        architectureVersion: row.architectureVersion
      },
      representativeRunIds: row.representativeRunIds,
      coverageLimits: {
        minRuns: DEFAULTS.minRuns,
        ambiguousOwnership: row.ambiguousOwnership
      }
    }));
  }
  return cards;
}

function skillPairCoactivatedRule(graph, metrics) {
  const independentByTarget = new Map();
  for (const row of (metrics.independentUse || [])) {
    independentByTarget.set(`${row.cohortId || 'unknown'}|${row.skill}|${row.otherSkill}`, row);
  }
  const cards = [];
  for (const row of (metrics.skillCoactivation || [])) {
    const pBGA = row.pBGivenA;
    const pAGB = row.pAGivenB;
    if (!pBGA.sufficient || !pAGB.sufficient) continue;
    const cohortId = pBGA.cohortId || 'unknown';
    const independentB = independentByTarget.get(`${cohortId}|${row.skillB}|${row.skillA}`);
    const independentA = independentByTarget.get(`${cohortId}|${row.skillA}|${row.skillB}`);
    const bHasIndependent = independentB && independentB.sufficient && independentB.rate !== null;
    const aHasIndependent = independentA && independentA.sufficient && independentA.rate !== null;
    const bothCoact = pBGA.rate >= DEFAULTS.coactivationRate && pAGB.rate >= DEFAULTS.coactivationRate;
    if (!bothCoact) continue;
    let secondary = null;
    if (bHasIndependent && independentB.rate <= DEFAULTS.coactivationIndependentUseCeiling) secondary = row.skillB;
    else if (aHasIndependent && independentA.rate <= DEFAULTS.coactivationIndependentUseCeiling) secondary = row.skillA;
    if (!secondary) continue;
    const primary = secondary === row.skillB ? row.skillA : row.skillB;
    cards.push(hypothesisCard({
      rule: 'SKILL_PAIR_COACTIVATED',
      summary: `Skills ${row.skillA} and ${row.skillB} co-activate: P(${row.skillB}|${row.skillA}) = ${pBGA.rate.toFixed(2)}, P(${row.skillA}|${row.skillB}) = ${pAGB.rate.toFixed(2)}. Independent use of ${secondary} ≤ ${DEFAULTS.coactivationIndependentUseCeiling}.`,
      componentRefs: [
        { kind: 'skill', name: row.skillA, role: primary === row.skillA ? 'primary' : 'secondary' },
        { kind: 'skill', name: row.skillB, role: primary === row.skillB ? 'primary' : 'secondary' }
      ],
      metricEvidence: {
        ...metricContract(pBGA),
        pBGivenA: pBGA,
        pAGivenB: pAGB,
        independentUseOfSecondary: secondary === row.skillB ? independentB : independentA,
        architectureVersion: pBGA.architectureVersion
      },
      representativeRunIds: row.representativeRunIds,
      coverageLimits: { minRuns: DEFAULTS.minRuns }
    }));
  }
  return cards;
}

function toolThrashRule(graph, metrics) {
  const cards = [];
  for (const row of (metrics.toolRepetition || [])) {
    if (!row.sufficient) continue;
    if (row.rate === null || row.rate < DEFAULTS.thrashShareThreshold) continue;
    const subStatus = row.confirmedByStateCount >= 1 ? 'confirmed-by-state-evidence' : 'suspected-by-name-only';
    cards.push(hypothesisCard({
      rule: 'TOOL_THRASH',
      subStatus,
      summary: subStatus === 'confirmed-by-state-evidence'
        ? `Tool ${row.tool} repeated ≥${DEFAULTS.thrashConsecutive} times in a row with no state progress in ${row.numerator}/${row.denominator} covered runs. ${row.confirmedByStateCount} of those carried explicit result-state evidence.`
        : `Tool ${row.tool} repeated ≥${DEFAULTS.thrashConsecutive} times in a row in ${row.numerator}/${row.denominator} covered runs. No explicit result-state evidence was present; this is suspected repetition, not confirmed thrash.`,
      componentRefs: [{ kind: 'tool', name: row.tool }],
      metricEvidence: {
        ...metricContract(row),
        numerator: row.numerator,
        denominator: row.denominator,
        coverageRuns: row.coverageRuns,
        interval: row.wilson,
        confirmedByStateCount: row.confirmedByStateCount,
        architectureVersion: row.architectureVersion
      },
      representativeRunIds: row.representativeRunIds,
      coverageLimits: {
        minRuns: DEFAULTS.minRuns,
        resultStateObserved: subStatus === 'confirmed-by-state-evidence'
      }
    }));
  }
  return cards;
}

function mechanicalLlmStepRule(graph, joinedRuns, metrics) {
  const perStep = new Map();
  for (const cohort of metricEligibleCohorts(graph, joinedRuns)) {
    for (const run of cohort.runs) {
      if (!run.taskContract || !Array.isArray(run.taskContract.deterministicSteps)) continue;
      if (run.taskContract.scriptCoverage !== 'complete') continue;
      for (const step of run.taskContract.deterministicSteps) {
        const key = `${cohort.cohortId}|${step.skillName}|${step.scriptName}`;
        if (!perStep.has(key)) perStep.set(key, { triggered: 0, total: 0, representatives: [], evidenceIds: [], runs: [], step });
        const entry = perStep.get(key);
        entry.total += 1;
        entry.runs.push(run);
        const modelCalls = run.modelCallsBySkill.get(step.skillName) || 0;
        const scriptSeen = run.scriptCalls.some(call => call.script === step.scriptName);
        if (!scriptSeen && modelCalls >= DEFAULTS.mechanicalModelCallsThreshold) {
          entry.triggered += 1;
          if (entry.representatives.length < 5) entry.representatives.push(run.runId);
          entry.evidenceIds.push(...eventIds([run], event => event.SkillName === step.skillName && ['assistant.turn_end', 'model.response', 'assistant.message'].includes(event.EventName)));
        }
      }
    }
  }
  const cards = [];
  for (const [, entry] of perStep) {
    if (entry.total < DEFAULTS.minRuns) continue;
    if (entry.triggered < 3) continue;
    const rate = entry.triggered / entry.total;
    cards.push(hypothesisCard({
      rule: 'MECHANICAL_LLM_STEP',
      subStatus: 'pilot-hypothesis',
      summary: `${entry.triggered}/${entry.total} task-contract-tagged runs showed ≥${DEFAULTS.mechanicalModelCallsThreshold} model calls on skill ${entry.step.skillName} while the designated script ${entry.step.scriptName} was never invoked under declared complete script coverage. This is a hypothesis — only an outcome-preserving experiment can confirm it.`,
      componentRefs: [
        { kind: 'skill', name: entry.step.skillName },
        { kind: 'script', path: entry.step.scriptName }
      ],
      metricEvidence: {
        ...evidenceMetadata(entry.runs, entry.evidenceIds, 'runs'),
        numerator: entry.triggered,
        denominator: entry.total,
        coverageRuns: entry.runs.length,
        rate,
        architectureVersion: graph.architectureVersion
      },
      representativeRunIds: entry.representatives,
      coverageLimits: {
        minRuns: DEFAULTS.minRuns,
        modelCallsThreshold: DEFAULTS.mechanicalModelCallsThreshold,
        requiresDeclaredTaskContract: true
      }
    }));
  }
  return cards;
}

function declaredNotObservedRule(graph, metrics) {
  const cards = [];
  const populations = metrics.declaredVsObserved?.cohorts || [metrics.declaredVsObserved];
  const summarise = (dvo, kind, name, extra = {}) => hypothesisCard({
    rule: 'DECLARED_NOT_OBSERVED',
    subStatus: 'informational',
    summary: `${kind} ${name} is declared in the inventory but was not observed in any of the ${dvo.coverageRuns} covered runs under architecture version ${dvo.architectureVersion.slice(0, 12)}.`,
    componentRefs: [{ kind, name, ...extra }],
    metricEvidence: {
      ...metricContract(dvo),
      numerator: 0,
      denominator: dvo.coverageRuns,
      coverageRuns: dvo.coverageRuns,
      architectureVersion: dvo.architectureVersion
    },
    representativeRunIds: [],
    coverageLimits: { minRuns: DEFAULTS.minRuns, note: 'Not observed does not mean unused — attach the next observed run and recheck.' }
  });
  for (const dvo of populations) {
    if (!dvo || !dvo.sufficient) continue;
    for (const agent of dvo.notObserved.agents) cards.push(summarise(dvo, 'agent', agent.name, { path: agent.path }));
    for (const skill of dvo.notObserved.skills) cards.push(summarise(dvo, 'skill', skill.name, { path: skill.path }));
    for (const ref of dvo.notObserved.references) cards.push(summarise(dvo, 'reference', ref.path, { ownerSkill: ref.ownerSkill }));
    for (const script of dvo.notObserved.scripts) cards.push(summarise(dvo, 'script', script.path, { ownerSkills: script.ownerSkills }));
  }
  return cards;
}

function evaluateFindings(graph, joinedRuns, options = {}) {
  cardCounter = 0;
  const metrics = options.metrics || computeAllMetrics(graph, joinedRuns, options);
  const covered = metricEligibleRuns(graph, joinedRuns);
  const cohorts = metricEligibleCohorts(graph, joinedRuns);
  const insufficientEvidence = !cohorts.some(cohort => cohort.runs.length >= DEFAULTS.minRuns);
  const cards = [];
  if (!insufficientEvidence) {
    cards.push(
      ...referenceNearMandatoryRule(graph, metrics),
      ...skillPairCoactivatedRule(graph, metrics),
      ...toolThrashRule(graph, metrics),
      ...mechanicalLlmStepRule(graph, joinedRuns, metrics),
      ...declaredNotObservedRule(graph, metrics)
    );
  }
  return {
    architectureVersion: graph.architectureVersion,
    coverageRuns: covered.length,
    cohorts: metrics.cohorts,
    insufficientEvidence,
    cards,
    metrics,
    deferredRules: ['SUBAGENT_LOW_VALUE', 'PROGRESSIVE_INDIRECTION']
  };
}

module.exports = {
  DEFAULTS,
  RULE_METADATA,
  declaredNotObservedRule,
  evaluateFindings,
  hypothesisCard,
  mechanicalLlmStepRule,
  referenceNearMandatoryRule,
  skillPairCoactivatedRule,
  toolThrashRule
};
