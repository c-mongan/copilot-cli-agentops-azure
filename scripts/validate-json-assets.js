#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const files = [
  'plugin/.mcp.json',
  'copilot/mcp.azure-monitor.sample.json',
  'copilot/mcp.grafana.sample.json',
  '.github/plugin/marketplace.json',
  ...fs.readdirSync('grafana')
    .filter(file => file.endsWith('.json'))
    .map(file => path.join('grafana', file))
];

for (const file of files) {
  JSON.parse(fs.readFileSync(file, 'utf8'));
}

console.log(`validated ${files.length} JSON files`);
