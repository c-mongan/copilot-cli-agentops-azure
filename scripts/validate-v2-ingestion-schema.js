#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { validateAgentOpsEventsBicepMigration } = require('../agentops-cli/src/lib/azure/v2-ingestion-schema-safety');

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const livePath = option('--live-schema');
if (!livePath) {
  process.stderr.write('Usage: node scripts/validate-v2-ingestion-schema.js --live-schema <table-schema.json> [--bicep <path>]\n');
  process.exitCode = 2;
} else {
  try {
    const bicepPath = path.resolve(option('--bicep') || path.join(__dirname, '../infra/bicep/v2-ingestion.bicep'));
    const livePayload = JSON.parse(fs.readFileSync(path.resolve(livePath), 'utf8'));
    const liveColumns = livePayload?.properties?.schema?.columns || livePayload?.schema?.columns || livePayload?.columns;
    const result = validateAgentOpsEventsBicepMigration(fs.readFileSync(bicepPath, 'utf8'), liveColumns);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
