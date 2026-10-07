const crypto = require('node:crypto');
const { redactContent } = require('./session-content');

const SCHEMA_VERSION = 1;
const HASH_ALGORITHM = 'sha256-16';
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,159}$/;
const MAX_LIST_ITEMS = 64;
const MAX_COUNT = 10000;
const SCOPE_KEYS = ['model', 'tools', 'mcp', 'skills'];
const SCOPE_STATES = new Set(['authoritative', 'observed', 'unknown']);
const COMPLETENESS_STATES = new Set(['authoritative', 'partial', 'unknown']);

function valuesFor(args, names) {
  const flags = Array.isArray(names) ? names : [names];
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    for (const name of flags) {
      if (arg === name) {
        if (index + 1 < args.length) values.push(String(args[index + 1]));
      } else if (arg.startsWith(`${name}=`)) {
        values.push(arg.slice(name.length + 1));
      }
    }
  }
  return values;
}

function flagPresent(args, names) {
  const flags = Array.isArray(names) ? names : [names];
  return args.some(value => flags.some(name => value === name || String(value).startsWith(`${name}=`)));
}

function safeValues(values, omitted) {
  const accepted = [];
  for (const raw of values) {
    for (const item of String(raw).split(',')) {
      const value = item.trim();
      if (!value) continue;
      if (SAFE_VALUE.test(value)) accepted.push(value);
      else omitted.count += 1;
    }
  }
  accepted.sort();
  if (accepted.length > MAX_LIST_ITEMS) omitted.count += accepted.length - MAX_LIST_ITEMS;
  return accepted.slice(0, MAX_LIST_ITEMS);
}

function safeFirst(args, names, omitted) {
  const values = valuesFor(args, names);
  if (!values.length) return null;
  const value = values[values.length - 1].trim();
  if (!SAFE_VALUE.test(value)) {
    omitted.count += 1;
    return null;
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function hashProjection(projection) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize({
    schema: 'agentops.execution-configuration.v1',
    settings: projection
  }))).digest('hex').slice(0, 16);
}

function boundedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, MAX_COUNT) : 0;
}

function safeStoredValue(value) {
  return typeof value === 'string' && SAFE_VALUE.test(value) ? value : null;
}

// Model/provider names are identifiers, not URLs or credential containers.
function safeModelIdentity(value) {
  if (!safeStoredValue(value) || /:\/\/|(?:^|\/)\/|[^/]*:[^/]*@/.test(value)) return null;
  if (redactContent(value) !== value || /^(?:gh[pousr]_|github_pat_|sk-(?:proj-|ant-)?|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]+\.)/i.test(value)) return null;
  return value;
}

function safeStoredList(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && SAFE_VALUE.test(item)).sort().slice(0, MAX_LIST_ITEMS)
    : [];
}

function sanitizeObservedSettings(settings = {}) {
  return canonicalize({
    model: {
      requested: safeStoredValue(settings.model?.requested),
      effort: safeStoredValue(settings.model?.effort),
      mode: safeStoredValue(settings.model?.mode)
    },
    tools: {
      allowAll: settings.tools?.allowAll === true,
      yolo: settings.tools?.yolo === true,
      allowAllTools: settings.tools?.allowAllTools === true,
      allowAllPaths: settings.tools?.allowAllPaths === true,
      allowAllUrls: settings.tools?.allowAllUrls === true,
      allowed: safeStoredList(settings.tools?.allowed),
      denied: safeStoredList(settings.tools?.denied),
      available: safeStoredList(settings.tools?.available),
      excluded: safeStoredList(settings.tools?.excluded)
    },
    mcp: {
      disableBuiltins: settings.mcp?.disableBuiltins === true,
      enableAllGithubTools: settings.mcp?.enableAllGithubTools === true,
      disabledServers: safeStoredList(settings.mcp?.disabledServers),
      githubTools: safeStoredList(settings.mcp?.githubTools),
      githubToolsets: safeStoredList(settings.mcp?.githubToolsets),
      additionalConfigCount: boundedCount(settings.mcp?.additionalConfigCount)
    },
    skills: {
      selectedAgent: safeStoredValue(settings.skills?.selectedAgent),
      pluginDirectoryCount: boundedCount(settings.skills?.pluginDirectoryCount),
      attachmentCount: boundedCount(settings.skills?.attachmentCount)
    },
    excludedValueCount: boundedCount(settings.excludedValueCount),
    secretArgumentCount: boundedCount(settings.secretArgumentCount)
  });
}

function unknownExecutionConfiguration() {
  return {
    schemaVersion: SCHEMA_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    configurationVersion: null,
    executionConfigurationHash: null,
    source: 'unknown',
    verification: 'unknown',
    completeness: 'unknown',
    scope: Object.fromEntries(SCOPE_KEYS.map(key => [key, 'unknown'])),
    observedSettings: null,
    excluded: {
      promptContent: true,
      secretBearingArguments: true,
      configFileContents: true,
      ambientConfiguration: true
    }
  };
}

function observedLaunchExecutionConfiguration(args = []) {
  const commandArgs = Array.isArray(args) ? args.map(value => String(value)) : [];
  const omitted = { count: 0 };
  const secretArgumentCount = valuesFor(commandArgs, '--secret-env-vars').length;
  const modelObserved = flagPresent(commandArgs, ['--model', '--effort', '--reasoning-effort', '--mode', '--copilot-mode']);
  const toolFlags = ['--allow-all', '--yolo', '--allow-all-tools', '--allow-all-paths', '--allow-all-urls', '--allow-tool', '--deny-tool', '--available-tools', '--excluded-tools'];
  const mcpFlags = ['--disable-mcp-server', '--add-github-mcp-tool', '--add-github-mcp-toolset', '--enable-all-github-mcp-tools', '--disable-builtin-mcps', '--additional-mcp-config'];
  const skillFlags = ['--agent', '--plugin-dir', '--attachment'];
  const toolsObserved = toolFlags.some(name => flagPresent(commandArgs, name));
  const mcpObserved = mcpFlags.some(name => flagPresent(commandArgs, name));
  const skillsObserved = skillFlags.some(name => flagPresent(commandArgs, name));

  if (!modelObserved && !toolsObserved && !mcpObserved && !skillsObserved) return unknownExecutionConfiguration();

  const observedSettings = sanitizeObservedSettings({
    model: {
      requested: safeModelIdentity(safeFirst(commandArgs, '--model', omitted)),
      effort: safeFirst(commandArgs, ['--effort', '--reasoning-effort'], omitted),
      mode: safeFirst(commandArgs, ['--mode', '--copilot-mode'], omitted)
    },
    tools: {
      allowAll: commandArgs.includes('--allow-all'),
      yolo: commandArgs.includes('--yolo'),
      allowAllTools: commandArgs.includes('--allow-all-tools'),
      allowAllPaths: commandArgs.includes('--allow-all-paths'),
      allowAllUrls: commandArgs.includes('--allow-all-urls'),
      allowed: safeValues(valuesFor(commandArgs, '--allow-tool'), omitted),
      denied: safeValues(valuesFor(commandArgs, '--deny-tool'), omitted),
      available: safeValues(valuesFor(commandArgs, '--available-tools'), omitted),
      excluded: safeValues(valuesFor(commandArgs, '--excluded-tools'), omitted)
    },
    mcp: {
      disableBuiltins: commandArgs.includes('--disable-builtin-mcps'),
      enableAllGithubTools: commandArgs.includes('--enable-all-github-mcp-tools'),
      disabledServers: safeValues(valuesFor(commandArgs, '--disable-mcp-server'), omitted),
      githubTools: safeValues(valuesFor(commandArgs, '--add-github-mcp-tool'), omitted),
      githubToolsets: safeValues(valuesFor(commandArgs, '--add-github-mcp-toolset'), omitted),
      additionalConfigCount: valuesFor(commandArgs, '--additional-mcp-config').length
    },
    skills: {
      selectedAgent: safeFirst(commandArgs, '--agent', omitted),
      pluginDirectoryCount: valuesFor(commandArgs, '--plugin-dir').length,
      attachmentCount: valuesFor(commandArgs, '--attachment').length
    },
    excludedValueCount: omitted.count,
    secretArgumentCount
  });
  const configurationVersion = hashProjection(observedSettings);
  return {
    schemaVersion: SCHEMA_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    configurationVersion,
    executionConfigurationHash: configurationVersion,
    source: 'observed_launch_arguments',
    verification: 'locally_derived_from_arguments',
    completeness: 'partial',
    scope: {
      model: modelObserved ? 'observed' : 'unknown',
      tools: toolsObserved ? 'observed' : 'unknown',
      mcp: mcpObserved ? 'observed' : 'unknown',
      skills: skillsObserved ? 'observed' : 'unknown'
    },
    observedSettings,
    excluded: {
      promptContent: true,
      secretBearingArguments: true,
      configFileContents: true,
      ambientConfiguration: true
    }
  };
}

function suppliedExecutionConfiguration(input = {}) {
  const configurationVersion = String(input.configurationVersion || input.executionConfigurationHash || '').trim();
  if (!/^[a-f0-9]{16,64}$/.test(configurationVersion)) {
    throw new Error('supplied execution configuration identity must be a 16 to 64 character lowercase hexadecimal hash');
  }
  const completeness = COMPLETENESS_STATES.has(input.completeness) ? input.completeness : 'unknown';
  const defaultScope = completeness === 'authoritative' ? 'authoritative' : 'unknown';
  const scope = Object.fromEntries(SCOPE_KEYS.map(key => {
    const state = input.scope?.[key];
    return [key, SCOPE_STATES.has(state) ? state : defaultScope];
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
    configurationVersion,
    executionConfigurationHash: configurationVersion,
    source: 'supplied_identity',
    verification: 'caller_asserted',
    completeness,
    scope,
    observedSettings: null,
    excluded: {
      promptContent: true,
      secretBearingArguments: true,
      configFileContents: true,
      ambientConfiguration: completeness !== 'authoritative'
    }
  };
}

function normalizeExecutionConfiguration(input) {
  if (!input) return unknownExecutionConfiguration();
  if (input.source === 'unknown' && !input.configurationVersion && !input.executionConfigurationHash) {
    return unknownExecutionConfiguration();
  }
  if (input.source === 'observed_launch_arguments') {
    const expected = Array.isArray(input.commandArgs)
      ? observedLaunchExecutionConfiguration(input.commandArgs)
      : {
        schemaVersion: SCHEMA_VERSION,
        hashAlgorithm: HASH_ALGORITHM,
        configurationVersion: hashProjection(sanitizeObservedSettings(input.observedSettings)),
        executionConfigurationHash: hashProjection(sanitizeObservedSettings(input.observedSettings)),
        source: 'observed_launch_arguments',
        verification: 'locally_derived_from_arguments',
        completeness: 'partial',
        scope: Object.fromEntries(SCOPE_KEYS.map(key => [key, input.scope?.[key] === 'observed' ? 'observed' : 'unknown'])),
        observedSettings: sanitizeObservedSettings(input.observedSettings),
        excluded: {
          promptContent: true,
          secretBearingArguments: true,
          configFileContents: true,
          ambientConfiguration: true
        }
      };
    if (input.configurationVersion && input.configurationVersion !== expected.configurationVersion) {
      throw new Error('observed execution configuration identity does not match its launch arguments');
    }
    if (input.executionConfigurationHash && input.executionConfigurationHash !== expected.executionConfigurationHash) {
      throw new Error('observed execution configuration hash does not match its launch arguments');
    }
    return expected;
  }
  return suppliedExecutionConfiguration(input);
}

// Producer request/response identity is distinct from an observed launcher request.
// Never use the legacy display-only `model` field as response evidence.
function reconcileModelProvenance({ launchExecutionConfiguration, requestedModel, events = [], nativeSpans = [] } = {}) {
  const configuration = launchExecutionConfiguration?.source === 'observed_launch_arguments'
    ? normalizeExecutionConfiguration(launchExecutionConfiguration) : null;
  const launchRequestedModel = safeModelIdentity(configuration?.observedSettings?.model?.requested) || safeModelIdentity(requestedModel);
  const unique = values => [...new Set(values.map(safeModelIdentity).filter(Boolean))].sort();
  const spans = nativeSpans.filter(span => span.match !== 'run-linked-script' && span.agent !== 'script OTel');
  const producerRequestedModels = unique([
    ...spans.map(span => span.modelRequested),
    ...events.map(event => event?.data?.requestedModel)
  ]);
  const actualModels = unique(spans.map(span => span.modelActual));
  const actualUsageIdentities = [...new Map(spans.filter(span => safeModelIdentity(span.modelActual)).map(span => {
    const identity = { model: safeModelIdentity(span.modelActual), provider: safeModelIdentity(span.provider) };
    return [JSON.stringify(identity), identity];
  })).values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const producerResponseConflicts = [...new Map(spans.filter(span => safeModelIdentity(span.modelRequested)
    && safeModelIdentity(span.modelActual) && span.modelRequested !== span.modelActual).map(span => {
    const conflict = { requested: safeModelIdentity(span.modelRequested), actual: safeModelIdentity(span.modelActual), provider: safeModelIdentity(span.provider) };
    return [JSON.stringify(conflict), conflict];
  })).values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const sessionReportedModels = unique(events.flatMap(event => {
    const data = event?.data || {};
    return [data.newModel, data.currentModel, data.model];
  }));
  const conflictingModels = launchRequestedModel ? unique([
    ...producerRequestedModels, ...actualModels, ...sessionReportedModels
  ]).filter(model => model !== launchRequestedModel) : [];
  const status = conflictingModels.length || producerResponseConflicts.length ? 'conflict'
    : !launchRequestedModel || !actualModels.length ? 'unknown'
      : actualModels.length > 1 ? 'mixed' : 'consistent_observation';
  return {
    launchRequestedModel: launchRequestedModel || null,
    launchRequestSource: safeModelIdentity(configuration?.observedSettings?.model?.requested)
      ? 'observed_launch_arguments' : launchRequestedModel ? 'launch_context' : 'unknown',
    producerRequestedModels,
    actualModels,
    actualUsageIdentities,
    sessionReportedModels,
    conflictingModels,
    producerResponseConflicts,
    mixedActualModels: actualModels.length > 1,
    actualUsageObserved: actualModels.length > 0,
    status,
    overrideCertified: false
  };
}

module.exports = {
  HASH_ALGORITHM,
  SCHEMA_VERSION,
  normalizeExecutionConfiguration,
  reconcileModelProvenance,
  safeModelIdentity,
  observedLaunchExecutionConfiguration,
  suppliedExecutionConfiguration,
  unknownExecutionConfiguration
};
