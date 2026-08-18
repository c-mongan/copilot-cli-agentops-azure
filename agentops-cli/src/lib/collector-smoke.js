const { normalizePrivacy } = require('./collector-options');
const { poisonCheck } = require('./privacy');
const { runtimePoisonSmoke } = require('./collector-runtime');

async function smokeCollector({
  options = {},
  status,
  findCollectorBinary,
  runPoisonCheck = poisonCheck,
  runRuntimePoisonSmoke = runtimePoisonSmoke
} = {}) {
  const privacy = normalizePrivacy(options.privacy || 'strict');
  const localPoison = options.poison === false ? null : runPoisonCheck();
  const currentStatus = await status({ mode: options.mode || 'auto', privacy });
  const runtime = options.poison === false
    ? null
    : await runRuntimePoisonSmoke({ privacy, findCollectorBinary });
  return {
    ok: privacy === 'strict' ? Boolean(localPoison?.ok && runtime?.ok !== false) : true,
    privacyMode: privacy,
    poison: localPoison,
    runtime_validation: currentStatus.running
      ? { status: 'collector-running', health: currentStatus.health, debug_exporter: runtime }
      : {
          status: 'skipped',
          reason: 'No local collector runtime is reachable in this environment. Offline strict sanitizer poison check was run.',
          debug_exporter: runtime
        }
  };
}

module.exports = {
  smokeCollector
};
