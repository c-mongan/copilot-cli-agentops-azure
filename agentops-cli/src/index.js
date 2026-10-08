#!/usr/bin/env node

const legacy = require('./legacy');
const { collectorCommand } = require('./commands/collector');
const { azureIngestCommand } = require('./commands/azure-ingest');
const { azureProvisionCommand } = require('./commands/azure-provision');
const { attachCommand, coverageCommand, detachCommand } = require('./commands/attach');
const { architectureCommand } = require('./commands/architecture');
const { askContextCommand } = require('./commands/ask-context');
const { contentCommand } = require('./commands/content');
const { copilotCommand } = require('./commands/copilot');
const { copilotSessionCommand } = require('./commands/copilot-session');
const { dashboardCommand } = require('./commands/dashboard');
const { demoCommand } = require('./commands/demo');
const { deliveryCommand } = require('./commands/delivery');
const { digestCommand } = require('./commands/digest');
const { doctorCommand } = require('./commands/doctor');
const { e2eCommand } = require('./commands/e2e');
const { explainCommand } = require('./commands/explain');
const { githubEnrichCommand } = require('./commands/github-enrich');
const { healthCommand } = require('./commands/health');
const { insightsCommand } = require('./commands/insights');
const { mcpProxyCommand } = require('./commands/mcp-proxy');
const { openCommand } = require('./commands/open');
const { productCommand } = require('./commands/product');
const { recommendCommand } = require('./commands/recommend');
const { runSummaryCommand } = require('./commands/run-summary');
const { schemaCommand } = require('./commands/schema');
const { securityCommand } = require('./commands/security');
const { statusCommand } = require('./commands/status');
const { triageCommand } = require('./commands/triage');
const { uiCommand } = require('./commands/ui');
const { createCliMain } = require('./lib/cli-dispatch');
const { coreCommands, experimentalCommands, usage } = require('./lib/cli-surface');

const commandHandlers = {
  azureIngestCommand,
  azureProvisionCommand,
  attachCommand,
  coverageCommand,
  detachCommand,
  architectureCommand,
  askContextCommand,
  collectorCommand,
  contentCommand,
  copilotCommand,
  copilotSessionCommand,
  dashboardCommand,
  demoCommand,
  deliveryCommand,
  digestCommand,
  doctorCommand,
  e2eCommand,
  explainCommand,
  githubEnrichCommand,
  healthCommand,
  insightsCommand,
  mcpProxyCommand,
  openCommand,
  productCommand,
  recommendCommand,
  runSummaryCommand,
  schemaCommand,
  securityCommand,
  statusCommand,
  triageCommand,
  uiCommand
};

const main = createCliMain({
  commands: commandHandlers,
  coreCommands,
  experimentalCommands,
  legacy,
  usage,
  version: require('../package.json').version
});

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  ...legacy,
  main,
  coreCommands,
  experimentalCommands,
  collectorCommand,
  azureIngestCommand,
  azureProvisionCommand,
  attachCommand,
  coverageCommand,
  detachCommand,
  architectureCommand,
  askContextCommand,
  contentCommand,
  copilotCommand,
  copilotSessionCommand,
  dashboardCommand,
  demoCommand,
  deliveryCommand,
  digestCommand,
  doctorCommand,
  e2eCommand,
  explainCommand,
  githubEnrichCommand,
  healthCommand,
  insightsCommand,
  mcpProxyCommand,
  openCommand,
  productCommand,
  recommendCommand,
  runSummaryCommand,
  schemaCommand,
  securityCommand,
  statusCommand,
  uiCommand,
  usage
};
