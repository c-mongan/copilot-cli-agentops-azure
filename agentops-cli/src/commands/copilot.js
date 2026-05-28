const childProcess = require('node:child_process');
const path = require('node:path');

const collector = require('../lib/collector-manager');
const { optionValue, withoutFlags } = require('../lib/args');
const { resolveCopilotBinary } = require('../lib/copilot-resolver');
const { copilotDir } = require('../lib/paths');

function removeAgentOpsCopilotFlags(args) {
  return withoutFlags(args, ['--collector-mode', '--privacy', '--unsafe-no-collector']);
}

async function copilotCommand(args = []) {
  const helpOnly = args.includes('--help') || args.includes('-h');
  const mode = optionValue(args, '--collector-mode', process.env.AGENTOPS_COLLECTOR_MODE || 'auto');
  const privacy = optionValue(args, '--privacy', process.env.AGENTOPS_PRIVACY_MODE || 'strict');
  const unsafeNoCollector = args.includes('--unsafe-no-collector') || process.env.AGENTOPS_ALLOW_NO_COLLECTOR === '1';
  const observedArgs = removeAgentOpsCopilotFlags(args);

  if (helpOnly) {
    const resolved = resolveCopilotBinary();
    if (!resolved.ok) throw new Error(resolved.error);
    const help = childProcess.spawnSync(resolved.path, observedArgs, { stdio: 'inherit', env: process.env });
    if (help.error) throw help.error;
    process.exitCode = help.status === null ? 1 : help.status;
    return;
  }

  const currentStatus = await collector.status({ mode, privacy });
  if (!currentStatus.running && mode !== 'none') {
    const started = await collector.start({ mode, privacy, unsafeNoCollector });
    if (!started.ok) {
      if (process.env.AGENTOPS_ALLOW_UNOBSERVED_FALLBACK === '1') {
        process.stderr.write(`WARNING: AgentOps collector unavailable; running unobserved because AGENTOPS_ALLOW_UNOBSERVED_FALLBACK=1. ${started.error || ''}\n`);
      } else {
        throw new Error(`AgentOps collector unavailable: ${started.error || 'unknown error'}`);
      }
    }
  }

  if (mode === 'none' && !unsafeNoCollector) {
    throw new Error('Collector mode none requires AGENTOPS_ALLOW_NO_COLLECTOR=1 or --unsafe-no-collector.');
  }

  const resolved = resolveCopilotBinary();
  if (!resolved.ok) throw new Error(resolved.error);

  const observeScript = path.join(copilotDir, 'copilot-observe');
  const env = {
    ...process.env,
    COPILOT_CLI_BIN: resolved.path,
    AGENTOPS_PRIVACY_MODE: privacy,
    AGENTOPS_COLLECTOR_MODE: mode
  };
  const result = childProcess.spawnSync(observeScript, observedArgs, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
}

module.exports = {
  copilotCommand,
  removeAgentOpsCopilotFlags
};
