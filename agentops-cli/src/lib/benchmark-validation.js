const fs = require('node:fs');
const path = require('node:path');
const { readJson } = require('./json');
const { isPlainObject, isStringArray } = require('./type-predicates');
const {
  benchmarkAllowedToolPolicyViolations,
  benchmarkPermissionProfiles,
  benchmarkProfileAllowsBroadArgs,
  hasBroadPermissionArg,
  normalizeBenchmarkPermissionProfile,
  validateBenchmarkToolPolicy
} = require('./benchmark-policy');
const {
  benchmarkFixtureFiles,
  benchmarkFixturePack,
  benchmarkFixtureSealPackSigningPayload,
  loadBenchmarkFixtureSealPack,
  signBenchmarkFixtureSealPack,
  stableJson,
  validateBenchmarkFixtureSeal,
  validateBenchmarkFixtureSealPack,
  validateBenchmarkFixtureSealPackSignature,
  validateBenchmarkFixtureTrustRevocations,
  validateBenchmarkFixtureTrustRoots
} = require('./benchmark-fixtures');

const benchmarkOsSandboxModes = new Set(['none', 'macos-network-blocked', 'container-network-blocked']);
const benchmarkSemanticAdapters = new Set(['file-contains', 'file-regex', 'file-rubric', 'llm-judge']);

function normalizeBenchmarkOsSandbox(sandbox, source = 'task') {
  if (sandbox === undefined || sandbox === null) {
    return { mode: 'none', enforced: false, network: 'not_enforced', tool: 'not_enforced' };
  }
  if (!isPlainObject(sandbox)) {
    throw new Error(`Invalid benchmark task ${source}: osSandbox must be an object`);
  }
  const mode = sandbox.mode === undefined ? 'none' : String(sandbox.mode);
  if (!benchmarkOsSandboxModes.has(mode)) {
    throw new Error(`Invalid benchmark task ${source}: osSandbox.mode must be one of: ${[...benchmarkOsSandboxModes].join(', ')}`);
  }
  if (mode === 'none') {
    return { mode, enforced: false, network: 'not_enforced', tool: 'not_enforced' };
  }
  if (mode === 'container-network-blocked') {
    if (typeof sandbox.image !== 'string' || sandbox.image.trim() === '') {
      throw new Error(`Invalid benchmark task ${source}: osSandbox.image is required for container-network-blocked`);
    }
    return {
      mode,
      enforced: true,
      network: 'blocked',
      tool: 'container_command_wrapped',
      platform: 'cross-platform-container-runtime',
      command: sandbox.runtime || 'docker',
      image: sandbox.image.trim()
    };
  }
  return {
    mode,
    enforced: true,
    network: mode === 'macos-network-blocked' ? 'blocked' : 'not_enforced',
    tool: 'copilot_command_wrapped',
    platform: 'darwin',
    command: 'sandbox-exec'
  };
}

function validateBenchmarkHiddenPack(pack, source = 'hidden check pack') {
  const errors = [];
  if (typeof pack.id !== 'string' || pack.id.trim() === '') errors.push('id must be a non-empty string');
  if (!isStringArray(pack.commands)) errors.push('commands must be an array of strings');
  if (errors.length > 0) {
    throw new Error(`Invalid benchmark hidden check pack ${source}: ${errors.join('; ')}`);
  }

  return {
    id: pack.id,
    title: typeof pack.title === 'string' && pack.title.trim() !== '' ? pack.title : pack.id,
    commands: pack.commands,
    source
  };
}

function loadBenchmarkHiddenPacks(task, suiteDir, source = 'task', options = {}) {
  if (task.hiddenCheckPacks === undefined) return [];
  if (!isStringArray(task.hiddenCheckPacks)) {
    throw new Error(`Invalid benchmark task ${source}: hiddenCheckPacks must be an array of strings`);
  }

  const root = options.root || process.cwd();
  return task.hiddenCheckPacks.map(packPath => {
    if (path.isAbsolute(packPath) || path.normalize(packPath).startsWith(`..${path.sep}`) || path.normalize(packPath) === '..') {
      throw new Error(`Invalid benchmark task ${source}: hidden check pack path cannot leave the suite: ${packPath}`);
    }
    const fullPath = path.resolve(suiteDir, packPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new Error(`Invalid benchmark task ${source}: hidden check pack does not exist: ${packPath}`);
    }
    return validateBenchmarkHiddenPack(readJson(fullPath), path.relative(root, fullPath));
  });
}

function validateBenchmarkPromotionGates(gates, source = 'suite') {
  if (gates === undefined) return null;
  if (!isPlainObject(gates)) {
    throw new Error(`Invalid benchmark ${source}: promotionGates must be an object`);
  }

  const allowedFields = new Set([
    'minPassRatePct',
    'minAverageScore',
    'maxToolFailures',
    'maxSafetyViolationCount',
    'maxTotalTokens',
    'maxCost',
    'requiredApprovals',
    'requiredApprovers',
    'requiredExternalReview'
  ]);
  const normalized = {};

  for (const [field, value] of Object.entries(gates)) {
    if (!allowedFields.has(field)) {
      throw new Error(`Invalid benchmark ${source}: unknown promotion gate: ${field}`);
    }
    if (field === 'requiredExternalReview') {
      if (typeof value !== 'boolean') {
        throw new Error(`Invalid benchmark ${source}: promotion gate requiredExternalReview must be a boolean`);
      }
      normalized[field] = value;
      continue;
    }
    if (field === 'requiredApprovers') {
      if (!isStringArray(value)) {
        throw new Error(`Invalid benchmark ${source}: promotion gate requiredApprovers must be an array of strings`);
      }
      const approvers = [...new Set(value.map(name => name.trim()).filter(Boolean))].sort();
      if (approvers.length === 0) {
        throw new Error(`Invalid benchmark ${source}: promotion gate requiredApprovers must include at least one approver`);
      }
      normalized[field] = approvers;
      continue;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`Invalid benchmark ${source}: promotion gate ${field} must be a non-negative number`);
    }
    if (field === 'requiredApprovals' && !Number.isInteger(number)) {
      throw new Error(`Invalid benchmark ${source}: promotion gate ${field} must be an integer`);
    }
    normalized[field] = number;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function validateBenchmarkJudgeProviders(providers, source = 'suite') {
  if (providers === undefined) return new Map();
  if (!isPlainObject(providers)) {
    throw new Error(`Invalid benchmark ${source}: judgeProviders must be an object`);
  }

  return new Map(Object.entries(providers).map(([id, provider]) => {
    const errors = [];
    if (id.trim() === '') errors.push('id must be a non-empty string');
    if (!isPlainObject(provider)) {
      throw new Error(`Invalid benchmark ${source}: judgeProviders.${id} must be an object`);
    }
    if (typeof provider.command !== 'string' || provider.command.trim() === '') {
      errors.push('command must be a non-empty string');
    }
    if (errors.length > 0) {
      throw new Error(`Invalid benchmark ${source}: judgeProviders.${id} ${errors.join('; ')}`);
    }
    return [id, { id, command: provider.command }];
  }));
}

function benchmarkJudgeProviderCommand(provider, check) {
  return provider.command
    .replaceAll('{file}', check.file)
    .replaceAll('{checkId}', check.id);
}

function validateBenchmarkSemanticChecks(checks, source = 'task', options = {}) {
  if (checks === undefined) return [];
  if (!Array.isArray(checks)) {
    throw new Error(`Invalid benchmark task ${source}: semanticChecks must be an array`);
  }

  const judgeProviders = options.judgeProviders || new Map();
  return checks.map((check, index) => {
    const errors = [];
    if (!isPlainObject(check)) {
      throw new Error(`Invalid benchmark task ${source}: semanticChecks[${index}] must be an object`);
    }
    if (typeof check.id !== 'string' || check.id.trim() === '') errors.push('id must be a non-empty string');
    if (!benchmarkSemanticAdapters.has(check.adapter)) {
      errors.push(`adapter must be one of: ${[...benchmarkSemanticAdapters].join(', ')}`);
    }
    if (typeof check.file !== 'string' || check.file.trim() === '') errors.push('file must be a non-empty string');
    if (check.adapter === 'file-contains' && (typeof check.contains !== 'string' || check.contains.trim() === '')) {
      errors.push('contains must be a non-empty string');
    }
    if (check.adapter === 'file-regex') {
      if (typeof check.pattern !== 'string' || check.pattern.trim() === '') {
        errors.push('pattern must be a non-empty string');
      } else {
        try {
          new RegExp(check.pattern);
        } catch {
          errors.push('pattern must be a valid regular expression');
        }
      }
    }
    if (check.adapter === 'file-rubric') {
      if (!Array.isArray(check.criteria) || check.criteria.length === 0) {
        errors.push('criteria must be a non-empty array');
      } else {
        for (const [criteriaIndex, criterion] of check.criteria.entries()) {
          if (!isPlainObject(criterion)) {
            errors.push(`criteria[${criteriaIndex}] must be an object`);
            continue;
          }
          if (typeof criterion.id !== 'string' || criterion.id.trim() === '') {
            errors.push(`criteria[${criteriaIndex}].id must be a non-empty string`);
          }
          const hasContains = typeof criterion.contains === 'string' && criterion.contains.trim() !== '';
          const hasPattern = typeof criterion.pattern === 'string' && criterion.pattern.trim() !== '';
          if (hasContains === hasPattern) {
            errors.push(`criteria[${criteriaIndex}] must define exactly one of contains or pattern`);
          }
          if (hasPattern) {
            try {
              new RegExp(criterion.pattern);
            } catch {
              errors.push(`criteria[${criteriaIndex}].pattern must be a valid regular expression`);
            }
          }
        }
      }
      if (check.minScore !== undefined) {
        const minScore = Number(check.minScore);
        if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
          errors.push('minScore must be between 0 and 100');
        }
      }
    }
    if (check.adapter === 'llm-judge') {
      const hasCommand = typeof check.command === 'string' && check.command.trim() !== '';
      const hasProvider = typeof check.provider === 'string' && check.provider.trim() !== '';
      if (!hasCommand && !hasProvider) {
        errors.push('command or provider must be a non-empty string');
      }
      if (hasProvider && !judgeProviders.has(check.provider)) {
        errors.push(`provider must reference a configured judge provider: ${check.provider}`);
      }
      if (check.minScore !== undefined) {
        const minScore = Number(check.minScore);
        if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
          errors.push('minScore must be between 0 and 100');
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(`Invalid benchmark task ${source}: semanticChecks[${index}] ${errors.join('; ')}`);
    }

    const normalized = {
      id: check.id,
      adapter: check.adapter,
      file: check.file
    };
    if (check.adapter === 'file-contains') normalized.contains = check.contains;
    if (check.adapter === 'file-regex') normalized.pattern = check.pattern;
    if (check.adapter === 'file-rubric') {
      normalized.minScore = check.minScore === undefined ? 100 : Number(check.minScore);
      normalized.criteria = check.criteria.map(criterion => {
        const normalizedCriterion = { id: criterion.id };
        if (typeof criterion.title === 'string' && criterion.title.trim() !== '') normalizedCriterion.title = criterion.title;
        if (criterion.contains !== undefined) normalizedCriterion.contains = criterion.contains;
        if (criterion.pattern !== undefined) normalizedCriterion.pattern = criterion.pattern;
        return normalizedCriterion;
      });
    }
    if (check.adapter === 'llm-judge') {
      if (typeof check.provider === 'string' && check.provider.trim() !== '') normalized.provider = check.provider;
      normalized.command = typeof check.command === 'string' && check.command.trim() !== ''
        ? check.command
        : benchmarkJudgeProviderCommand(judgeProviders.get(check.provider), check);
      normalized.minScore = check.minScore === undefined ? 100 : Number(check.minScore);
    }
    return normalized;
  });
}

function validateBenchmarkTask(task, suiteDir, source = 'task', options = {}) {
  const errors = [];
  const stringFields = ['id', 'title', 'fixture', 'prompt'];
  const arrayFields = ['copilotArgs', 'successCommands', 'expectedFiles', 'forbiddenFiles', 'tags'];
  const optionalArrayFields = ['hiddenSuccessCommands'];

  for (const field of stringFields) {
    if (typeof task[field] !== 'string' || task[field].trim() === '') {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  for (const field of arrayFields) {
    if (!isStringArray(task[field])) {
      errors.push(`${field} must be an array of strings`);
    }
  }

  for (const field of optionalArrayFields) {
    if (task[field] !== undefined && !isStringArray(task[field])) {
      errors.push(`${field} must be an array of strings`);
    }
  }

  const permissionProfile = normalizeBenchmarkPermissionProfile(task.permissionProfile);
  if (!benchmarkPermissionProfiles.has(permissionProfile)) {
    errors.push(`permissionProfile must be one of: ${[...benchmarkPermissionProfiles].join(', ')}`);
  }
  if (hasBroadPermissionArg(task.copilotArgs || []) && !benchmarkProfileAllowsBroadArgs(permissionProfile)) {
    errors.push('copilotArgs uses broad permissions but permissionProfile is not allow-all-isolated');
  }

  if (!Number.isInteger(task.timeoutSec) || task.timeoutSec <= 0) {
    errors.push('timeoutSec must be a positive integer');
  }

  const fixturePath = typeof task.fixture === 'string' ? path.resolve(suiteDir, task.fixture) : null;
  if (fixturePath && (!fs.existsSync(fixturePath) || !fs.statSync(fixturePath).isDirectory())) {
    errors.push(`fixture does not exist: ${task.fixture}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid benchmark task ${source}: ${errors.join('; ')}`);
  }

  const hiddenCheckPacks = loadBenchmarkHiddenPacks(task, suiteDir, source, options);
  const hiddenPackCommands = hiddenCheckPacks.flatMap(pack => pack.commands);
  const semanticChecks = validateBenchmarkSemanticChecks(task.semanticChecks, source, options);
  const fixtureSeal = validateBenchmarkFixtureSeal(task.fixtureSeal, fixturePath, source);
  const fixtureSealPack = loadBenchmarkFixtureSealPack(task, suiteDir, fixturePath, source, options);
  const commandFileSeal = validateBenchmarkFixtureSeal(task.commandFileSeal, fixturePath, source);
  const osSandbox = normalizeBenchmarkOsSandbox(task.osSandbox, source);
  const toolPolicy = validateBenchmarkToolPolicy(task.toolPolicy, source);
  const toolPolicyEnforcement = {
    blockedRisks: toolPolicy?.blockedRisks || [],
    blockedAllowedTools: benchmarkAllowedToolPolicyViolations(task.copilotArgs, toolPolicy)
  };

  return {
    ...task,
    hiddenSuccessCommands: task.hiddenSuccessCommands || [],
    hiddenCheckPacks,
    hiddenCheckPackRefs: task.hiddenCheckPacks || [],
    hiddenPackCommands,
    semanticChecks,
    fixtureSeal,
    fixtureSealPack,
    commandFileSeal,
    toolPolicy,
    toolPolicyEnforcement,
    osSandbox,
    permissionProfile,
    fixturePath,
    source
  };
}

function loadBenchmarkSuites(baseDir, options = {}) {
  const root = options.root || process.cwd();
  if (!fs.existsSync(baseDir)) return [];

  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const suiteDir = path.join(baseDir, entry.name);
      const suitePath = path.join(suiteDir, 'suite.json');
      const metadata = fs.existsSync(suitePath) ? readJson(suitePath) : {};
      const fixtureTrustRoots = validateBenchmarkFixtureTrustRoots(metadata.fixtureTrustRoots, path.relative(root, suitePath));
      const fixtureTrustRevocations = validateBenchmarkFixtureTrustRevocations(metadata.fixtureTrustRevocations, path.relative(root, suitePath));
      const judgeProviders = validateBenchmarkJudgeProviders(metadata.judgeProviders, path.relative(root, suitePath));
      const tasksDir = path.join(suiteDir, 'tasks');
      const taskFiles = fs.existsSync(tasksDir)
        ? fs.readdirSync(tasksDir).filter(file => file.endsWith('.json')).sort()
        : [];
      const promotionGates = validateBenchmarkPromotionGates(metadata.promotionGates, path.relative(root, suitePath));
      const tasks = taskFiles.map(file => {
        const taskPath = path.join(tasksDir, file);
        return validateBenchmarkTask(readJson(taskPath), suiteDir, path.relative(root, taskPath), {
          ...options,
          fixtureTrustRoots,
          fixtureTrustRevocations,
          judgeProviders
        });
      });

      return {
        id: metadata.id || entry.name,
        title: metadata.title || entry.name,
        description: metadata.description || '',
        path: path.relative(root, suiteDir),
        fixtureTrustRoots: fixtureTrustRoots.map(rootEntry => ({
          keyId: rootEntry.keyId,
          ...(rootEntry.notBefore ? { notBefore: rootEntry.notBefore } : {}),
          ...(rootEntry.notAfter ? { notAfter: rootEntry.notAfter } : {})
        })),
        fixtureTrustRevocations,
        judgeProviders: [...judgeProviders.values()].map(provider => ({ id: provider.id })),
        promotionGates,
        tasks
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function listBenchmarks(baseDir, options = {}) {
  return {
    suites: loadBenchmarkSuites(baseDir, options).map(suite => ({
      id: suite.id,
      title: suite.title,
      description: suite.description,
      path: suite.path,
      tasks: suite.tasks.map(task => ({
        id: task.id,
        title: task.title,
        fixture: task.fixture,
        permissionProfile: task.permissionProfile,
        toolPolicy: task.toolPolicy,
        timeoutSec: task.timeoutSec,
        tags: task.tags
      }))
    }))
  };
}

module.exports = {
  benchmarkAllowedToolPolicyViolations,
  benchmarkFixtureFiles,
  benchmarkFixturePack,
  benchmarkFixtureSealPackSigningPayload,
  benchmarkJudgeProviderCommand,
  benchmarkProfileAllowsBroadArgs,
  hasBroadPermissionArg,
  isPlainObject,
  isStringArray,
  listBenchmarks,
  loadBenchmarkFixtureSealPack,
  loadBenchmarkHiddenPacks,
  loadBenchmarkSuites,
  normalizeBenchmarkOsSandbox,
  normalizeBenchmarkPermissionProfile,
  signBenchmarkFixtureSealPack,
  stableJson,
  validateBenchmarkFixtureSeal,
  validateBenchmarkFixtureSealPack,
  validateBenchmarkFixtureSealPackSignature,
  validateBenchmarkFixtureTrustRevocations,
  validateBenchmarkFixtureTrustRoots,
  validateBenchmarkHiddenPack,
  validateBenchmarkJudgeProviders,
  validateBenchmarkPromotionGates,
  validateBenchmarkSemanticChecks,
  validateBenchmarkTask,
  validateBenchmarkToolPolicy
};
