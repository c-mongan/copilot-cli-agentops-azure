// Local, deterministic comparison only. A stored outcome never authorizes a change.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_TRIALS = 1000;
const MAX_FILES = 1000;
const MAX_BYTES = 1024 * 1024;
const NUISANCE = ['modelRequested', 'modelActual', 'provider', 'runtime', 'tools', 'mcp', 'settings'];
const TASK = ['task', 'dataset', 'grader'];
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const known = value => typeof value === 'string' && value.length <= 2000 && !!value.trim() && !['unknown', 'partial'].includes(value.trim().toLowerCase());
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safePath = value => known(value) && !path.isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');
const stable = value => JSON.stringify(Array.isArray(value) ? value.map(v => JSON.parse(stable(v))) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(stable(value[k]))])) : value);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const median = values => { const sorted = [...values].sort((a,b) => a-b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2; };

// Read the complete declared architecture surface, never follow symlinks. The caller
// must choose a non-secret root; output contains paths and hashes, never file content.
function captureArchitecture(root) {
  const files = {};
  let bytes = 0;
  let directories = 0;
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) throw new Error('architecture root must be a real directory');
  const walk = (dir, depth = 0) => {
    if (++directories > MAX_FILES || depth > 16) throw new Error('architecture directory limit exceeded');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const filename = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('symlinks are not allowed in architecture snapshots');
      if (entry.isDirectory()) walk(filename, depth + 1);
      else if (entry.isFile()) {
        const relative = path.relative(root, filename).split(path.sep).join('/');
        if (!safePath(relative) || Object.keys(files).length >= MAX_FILES) throw new Error('architecture snapshot file limit or path violation');
        const size = fs.statSync(filename).size;
        bytes += size;
        if (bytes > MAX_BYTES) throw new Error('architecture snapshot exceeds byte limit');
        const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const stat = fs.fstatSync(fd);
          if (!stat.isFile() || stat.size !== size) throw new Error('architecture file changed during snapshot');
          const content = Buffer.alloc(size + 1);
          const length = fs.readSync(fd, content, 0, content.length, 0);
          if (length !== size) throw new Error('architecture file changed during snapshot');
          files[relative] = digest(content.subarray(0, length));
        } finally { fs.closeSync(fd); }
      } else throw new Error('unsupported architecture entry');
    }
  };
  walk(root);
  if (!Object.keys(files).length) throw new Error('empty architecture snapshot');
  return { files, architectureVersion: digest(stable(files)), scope: 'complete-declared-root' };
}

function validateExperiment(record, options = {}) {
  const reasons = [];
  const fail = reason => reasons.push(reason);
  try {
    if (!plain(record) || Buffer.byteLength(JSON.stringify(record)) > MAX_BYTES) return { compatible: false, provenance: 'unknown', reasons: ['malformed or oversized record'] };
    const contract = record.contract;
    if (!plain(contract) || contract.version !== 1) return { compatible: false, provenance: 'unknown', reasons: ['legacy or unknown comparison contract; unknown or mismatched architecture/configuration cannot support an efficiency conclusion'] };
    if (!plain(contract.treatment) || !safePath(contract.treatment.path) || !hash(contract.treatment.beforeHash) || !hash(contract.treatment.afterHash) || contract.treatment.beforeHash === contract.treatment.afterHash) fail('invalid single-path treatment');
    if (contract.declaredBeforeTrials !== true || !known(contract.planEvidenceRef)) fail('predeclared plan evidence is missing');
    const sides = [record.baseline, record.candidate];
    for (const side of sides) {
      if (!plain(side) || !plain(side.architectureSnapshot) || side.architectureSnapshot.scope !== 'complete-declared-root' || !plain(side.architectureSnapshot.files)) { fail('complete architecture snapshot is missing'); continue; }
      const files = side.architectureSnapshot.files;
      if (!Object.keys(files).length || Object.keys(files).length > MAX_FILES || !Object.entries(files).every(([p,h]) => safePath(p) && hash(h)) || side.architectureVersion !== digest(stable(files))) fail('architecture snapshot identity is invalid');
      if (!plain(side.identity) || ![...NUISANCE, ...TASK].every(key => known(side.identity[key]))) fail('unknown nuisance or task/dataset/grader identity');
      const evidence = side.identityEvidence;
      if (!plain(evidence) || evidence.completeness !== 'authoritative' || evidence.verification !== 'caller_asserted' || !known(evidence.ref)) fail('partial or unknown identity provenance');
    }
    if (sides.every(side => plain(side?.identity))) for (const key of [...NUISANCE, ...TASK]) if (sides[0].identity[key] !== sides[1].identity[key]) fail(`${key} mismatch`);
    if (sides.every(side => plain(side?.architectureSnapshot?.files)) && plain(contract.treatment)) {
      const [a,b] = sides.map(side => side.architectureSnapshot.files);
      const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => a[key] !== b[key]);
      if (changed.length !== 1 || changed[0] !== contract.treatment.path || a[contract.treatment.path] !== contract.treatment.beforeHash || b[contract.treatment.path] !== contract.treatment.afterHash) fail('unexpected architecture drift or treatment content mismatch');
    }
    const criteria = contract.criteria;
    if (!plain(criteria) || !Number.isInteger(criteria.minimumTrials) || criteria.minimumTrials < 2 || criteria.minimumTrials > MAX_TRIALS || !Number.isFinite(criteria.minimumEffect) || criteria.minimumEffect <= 0 || criteria.minimumEffect > 1 || criteria.maximumQualityRegression !== 0 || criteria.requireAllCandidatePass !== true || !['toolCalls', 'durationMs', 'inputTokens', 'outputTokens'].includes(criteria.metric)) fail('invalid predeclared sample/effect/quality criteria');
    let local = false;
    if (options.baselineRoot && options.candidateRoot) {
      const snapshots = [captureArchitecture(options.baselineRoot), captureArchitecture(options.candidateRoot)];
      local = snapshots.every((snapshot, index) => stable(snapshot.files) === stable(sides[index]?.architectureSnapshot?.files));
      if (!local) fail('local files do not match declared snapshots');
    }
    return { compatible: reasons.length === 0, provenance: local ? 'local-files-verified; runtime/task identities remain caller-asserted, not independently verified' : 'caller-asserted; not independently verified', reasons };
  } catch { return { compatible: false, provenance: 'unknown', reasons: ['malformed or bounded input violation'] }; }
}

function evaluateExperiment(record, options = {}) {
  const validation = validateExperiment(record, options);
  const result = (status, reason, extra = {}) => ({ ...validation, status, reason, ...extra, statisticalClaim: 'descriptive only; no statistical significance established', authorization: 'none' });
  if (!validation.compatible) return result('inconclusive', validation.reasons.join('; '));
  const criteria = record.contract.criteria;
  const sides = [record.baseline, record.candidate];
  const evidenceRefs = [];
  const runIds = new Set();
  for (const side of sides) {
    const trials = side.trialEvidence;
    if (!Array.isArray(trials) || trials.length > MAX_TRIALS) return result('inconclusive', 'malformed or oversized trial evidence');
    for (const trial of trials) {
      if (!plain(trial) || !known(trial.runId) || runIds.has(trial.runId) || typeof trial.passed !== 'boolean' || !Number.isFinite(trial[criteria.metric]) || trial[criteria.metric] < 0 || !Array.isArray(trial.sinkEvidenceRefs) || !trial.sinkEvidenceRefs.length || trial.sinkEvidenceRefs.length > 20 || !trial.sinkEvidenceRefs.every(known)) return result('inconclusive', 'malformed trial, missing actual sink evidence refs, or duplicate run');
      if (![...NUISANCE, ...TASK].every(key => trial.identity?.[key] === side.identity[key])) return result('inconclusive', 'trial actual model, nuisance, or task/dataset/grader mismatch');
      runIds.add(trial.runId);
      evidenceRefs.push(...trial.sinkEvidenceRefs);
    }
  }
  const [baseline, candidate] = sides.map(side => side.trialEvidence);
  const quality = baseline.filter(trial => trial.passed).length / baseline.length;
  const candidateQuality = candidate.filter(trial => trial.passed).length / candidate.length;
  if (candidateQuality < quality || candidate.some(trial => !trial.passed)) return result('rejected', 'candidate failed a task or regressed quality; efficiency cannot override correctness', { evidenceRefs });
  if (baseline.some(trial => !trial.passed)) return result('inconclusive', 'baseline quality gate failed; repair baseline before an efficiency conclusion', { evidenceRefs });
  if (sides.some(side => side.trialEvidence.length < criteria.minimumTrials)) return result('inconclusive', 'inadequate repeated trials', { evidenceRefs });
  const baselineMedian = median(baseline.map(trial => trial[criteria.metric]));
  const candidateMedian = median(candidate.map(trial => trial[criteria.metric]));
  if (baselineMedian === 0) return result('inconclusive', 'zero baseline prevents relative effect measurement', { evidenceRefs });
  const effect = (baselineMedian - candidateMedian) / baselineMedian;
  return result(effect >= criteria.minimumEffect ? 'criteria-met' : 'inconclusive', effect >= criteria.minimumEffect ? 'predeclared descriptive quality and effect criteria met, conditional on caller assertions; independent review required' : 'predeclared minimum effect not met', { effect, baselineMedian, candidateMedian, evidenceRefs });
}
module.exports = { captureArchitecture, validateExperiment, evaluateExperiment };
