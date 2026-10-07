const { hasFlag, optionValue } = require('./args');
const { writeJsonOrRender } = require('./command-output');
const { doctorSummary, renderDoctor } = require('./doctor-summary');
const { doctorPipeline, renderPipeline, useColor } = require('./doctor-pipeline');

async function doctorCommand(args = []) {
  const json = hasFlag(args, '--json');
  const verbose = hasFlag(args, '--verbose');
  const cloud = hasFlag(args, '--cloud');
  // The default checklist makes no network calls. --json and --verbose keep the
  // historical contract (Azure/Grafana validation unless --local-only).
  const localOnly = hasFlag(args, '--local-only') || (!json && !verbose && !cloud);
  const mode = process.env.AGENTOPS_COLLECTOR_MODE || 'auto';
  const summary = await doctorSummary({
    mode,
    localOnly,
    last: optionValue(args, '--last', undefined)
  });
  summary.pipeline = await doctorPipeline({ mode, cloud, collectorStatus: summary.collector, copilot: summary.copilot });
  writeJsonOrRender(summary, json, value => {
    const pipeline = renderPipeline(value.pipeline, { color: useColor(process.stdout), verbose });
    return verbose ? `${pipeline}\n${renderDoctor(value)}` : pipeline;
  });
  // Exit code still reflects only blocking low-level checks so CI and install
  // smoke tests that run `doctor --local-only` keep their meaning.
  process.exitCode = summary.ok ? 0 : 1;
}

module.exports = {
  doctorCommand,
  doctorSummary,
  renderDoctor
};
