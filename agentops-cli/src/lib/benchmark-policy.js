const { extractAllowedTools } = require('./copilot/tool-classifier');
const { isPlainObject, isStringArray } = require('./type-predicates');

const benchmarkPermissionProfiles = new Set(['allow-all-isolated', 'least-privilege', 'read-only']);
const benchmarkToolRisks = new Set([
  'read-only',
  'write-file',
  'shell',
  'network',
  'secret-access',
  'browser-control',
  'destructive',
  'privileged'
]);

function normalizeBenchmarkPermissionProfile(profile) {
  if (profile === undefined || profile === null || profile === '') return 'least-privilege';
  return String(profile);
}

function benchmarkProfileAllowsBroadArgs(profile) {
  return profile === 'allow-all-isolated';
}

function hasBroadPermissionArg(args = []) {
  return args.some(arg => ['--allow-all', '--yolo'].includes(arg));
}

function validateBenchmarkToolPolicy(policy, source = 'task') {
  if (policy === undefined) return null;
  if (!isPlainObject(policy)) {
    throw new Error(`Invalid benchmark task ${source}: toolPolicy must be an object`);
  }

  if (policy.blockedRisks === undefined) return null;
  if (!isStringArray(policy.blockedRisks)) {
    throw new Error(`Invalid benchmark task ${source}: toolPolicy.blockedRisks must be an array of strings`);
  }

  const blockedRisks = [...new Set(policy.blockedRisks.map(risk => risk.trim()).filter(Boolean))].sort();
  const invalid = blockedRisks.filter(risk => !benchmarkToolRisks.has(risk));
  if (invalid.length > 0) {
    throw new Error(`Invalid benchmark task ${source}: toolPolicy.blockedRisks must use known risks: ${[...benchmarkToolRisks].join(', ')}`);
  }

  return blockedRisks.length > 0 ? { blockedRisks } : null;
}

function benchmarkAllowedToolPolicyViolations(args = [], toolPolicy = null) {
  const blockedRisks = new Set(toolPolicy?.blockedRisks || []);
  if (blockedRisks.size === 0) return [];

  const seen = new Set();
  return extractAllowedTools(args)
    .filter(tool => blockedRisks.has(tool.risk))
    .filter(tool => {
      const key = `${tool.name}:${tool.risk}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.risk.localeCompare(right.risk) || left.name.localeCompare(right.name));
}

module.exports = {
  benchmarkAllowedToolPolicyViolations,
  benchmarkPermissionProfiles,
  benchmarkProfileAllowsBroadArgs,
  hasBroadPermissionArg,
  normalizeBenchmarkPermissionProfile,
  validateBenchmarkToolPolicy
};
