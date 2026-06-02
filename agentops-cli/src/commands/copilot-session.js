const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { optionValue, parseJsonFlag } = require('../lib/args');
const {
  defaultSessionEventsPath,
  enrichCopilotSessionEvents,
  readCopilotSessionEvents
} = require('../lib/copilot/session-enricher');
const { agentopsCustomImport, customEventId } = require('../legacy');

function parseCopilotSessionArgs(args = []) {
  const [subcommand, sessionId] = args;
  return {
    subcommand,
    sessionId,
    file: optionValue(args, '--file'),
    endpoint: optionValue(args, '--endpoint', 'http://127.0.0.1:4318'),
    id: optionValue(args, '--id') || customEventId(),
    dryRun: args.includes('--dry-run'),
    json: parseJsonFlag(args)
  };
}

async function buildCopilotSessionEnrichment(options = {}) {
  if (options.subcommand !== 'enrich') throw new Error('copilot-session supports: enrich <session-id>');
  if (!options.sessionId && !options.file) throw new Error('copilot-session enrich requires <session-id> or --file <events.jsonl>');

  const eventsFile = options.file || defaultSessionEventsPath(options.sessionId);
  const sessionId = options.sessionId || path.basename(path.dirname(eventsFile));
  const rawEvents = readCopilotSessionEvents(eventsFile);
  const rows = enrichCopilotSessionEvents(rawEvents, { sessionId });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-copilot-session-'));
  const outFile = path.join(tempDir, 'AgentOpsCopilotSessionEnrichment.jsonl');

  try {
    fs.writeFileSync(outFile, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
    const result = await agentopsCustomImport(outFile, {
      id: options.id,
      endpoint: options.endpoint,
      dryRun: options.dryRun,
      last: '2h'
    });
    return {
      ...result,
      ok: result.ok && rows.length > 0,
      session_id: sessionId,
      source_file: eventsFile,
      enriched_rows: rows.length,
      event_counts: rows.reduce((counts, row) => {
        counts[row.event] = (counts[row.event] || 0) + 1;
        return counts;
      }, {}),
      preview: rows.slice(0, 8).map(row => ({
        event: row.event,
        agent: row.agent,
        skill: row.attributes?.['agentops.skill.name'] || '',
        mcp_server: row.attributes?.['agentops.mcp.server'] || '',
        tool: row.attributes?.['gen_ai.tool.name'] || '',
        outcome: row.outcome || ''
      }))
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function renderCopilotSessionEnrichment(result = {}) {
  const lines = [
    'Copilot session enrichment',
    `Session: ${result.session_id}`,
    `Source: ${result.source_file}`,
    `Rows: ${result.enriched_rows}`,
    `Dry run: ${Boolean(result.dry_run)}`,
    `OK: ${Boolean(result.ok)}`
  ];
  if (result.event_counts) {
    lines.push('', 'Events:');
    for (const [event, count] of Object.entries(result.event_counts)) lines.push(`- ${event}: ${count}`);
  }
  if (result.next?.length) {
    lines.push('', 'Next:');
    for (const item of result.next) lines.push(`- ${item}`);
  }
  return `${lines.join('\n')}\n`;
}

async function copilotSessionCommand(args = []) {
  const options = parseCopilotSessionArgs(args);
  const result = await buildCopilotSessionEnrichment(options);
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : renderCopilotSessionEnrichment(result));
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = {
  buildCopilotSessionEnrichment,
  copilotSessionCommand,
  parseCopilotSessionArgs,
  renderCopilotSessionEnrichment
};
