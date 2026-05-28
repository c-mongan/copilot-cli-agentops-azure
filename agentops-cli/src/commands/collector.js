const collector = require('../lib/collector-manager');

function renderCollector(result) {
  const lines = ['AgentOps collector'];
  lines.push(`Mode: ${result.effectiveMode || result.mode}`);
  if (result.privacyMode) lines.push(`Privacy: ${result.privacyMode}`);
  if (result.running !== undefined) lines.push(`Running: ${result.running ? 'yes' : 'no'}`);
  if (result.endpoint) lines.push(`OTLP endpoint: ${result.endpoint}`);
  if (result.healthUrl) lines.push(`Health: ${result.healthUrl}`);
  if (result.error) lines.push(`Error: ${result.error}`);
  if (result.warning) lines.push(`Warning: ${result.warning}`);
  if (result.action === 'install-binary') {
    lines.push(`Binary: ${result.path}`);
    lines.push(`Version: ${result.version}`);
    if (result.alreadyInstalled) lines.push('Already installed: yes');
  }
  if (result.action === 'uninstall-binary') {
    lines.push(`Removed binaries: ${result.removed?.length || 0}`);
    if (result.collectorHome) lines.push(`Collector home: ${result.collectorHome}`);
  }
  if (result.details?.length) {
    lines.push('', 'Details:');
    for (const detail of result.details) lines.push(`- ${detail}`);
  }
  if (result.poison) {
    lines.push('', `Poison privacy check: ${result.poison.ok ? 'passed' : 'failed'}`);
    if (result.poison.leaked?.length) lines.push(`Leaks: ${result.poison.leaked.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

async function collectorCommand(args = []) {
  const [action = 'status'] = args;
  const options = collector.parseCollectorOptions(args);
  let result;

  if (action === 'status') result = await collector.status(options);
  else if (action === 'start') result = await collector.start(options);
  else if (action === 'stop') result = collector.stop(options);
  else if (action === 'validate') result = collector.validate(options);
  else if (action === 'smoke') result = await collector.smoke(options);
  else if (action === 'install-binary') result = await collector.installBinary(options);
  else if (action === 'uninstall-binary') result = collector.uninstallBinary(options);
  else throw new Error('collector requires start, stop, status, validate, smoke, install-binary, or uninstall-binary');

  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : renderCollector(result));
  process.exitCode = result.ok === false && action !== 'status' ? 1 : 0;
}

module.exports = {
  collectorCommand,
  renderCollector
};
