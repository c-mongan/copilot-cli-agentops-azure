const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const legacy = require('../../legacy');
const { optionValue, optionValues, parseJsonFlag } = require('../args');
const { otlpHttpEndpoint } = require('../collector-endpoints');
const { writeJsonlFile, writeJsonOrRender } = require('../command-output');
const {
  defaultSessionEventsPath,
  enrichCopilotSessionEvents,
  readScriptSidecarEvents,
  readCopilotSessionEvents
} = require('./session-enricher');
const { writeSessionWaterfall } = require('./session-waterfall');
const { defaultReceiptFiles, readSessionOtelSpans } = require('./session-otel');
const { writeSessionContent } = require('./session-content');

function parseCopilotSessionArgs(args = []) {
  const [subcommand, sessionId] = args;
  return {
    subcommand,
    sessionId,
    file: optionValue(args, '--file'),
    output: optionValue(args, '--output'),
    allowContent: args.includes('--allow-content'),
    synthetic: args.includes('--synthetic'),
    sidecarFile: optionValue(args, '--sidecar'),
    otelFiles: optionValues(args, '--otel-file'),
    runId: optionValue(args, '--run-id'),
    endpoint: optionValue(args, '--endpoint', otlpHttpEndpoint),
    id: optionValue(args, '--id') || legacy.customEventId(),
    dryRun: args.includes('--dry-run'),
    json: parseJsonFlag(args)
  };
}

async function buildCopilotSessionEnrichment(options = {}) {
  if (options.subcommand !== 'enrich') throw new Error('copilot-session supports: enrich <session-id>');
  if (!options.sessionId && !options.file) throw new Error('copilot-session enrich requires <session-id> or --file <events.jsonl>');

  const eventsFile = options.file || defaultSessionEventsPath(options.sessionId);
  const sessionId = options.sessionId || path.basename(path.dirname(eventsFile));
  const sidecarFile = options.sidecarFile || path.join(process.cwd(), '.agentops', 'sidecar-events.jsonl');
  const rawEvents = [
    ...readCopilotSessionEvents(eventsFile),
    ...readScriptSidecarEvents(sidecarFile, sessionId)
  ].sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')));
  const rows = enrichCopilotSessionEvents(rawEvents, { sessionId });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-copilot-session-'));
  const outFile = path.join(tempDir, 'AgentOpsCopilotSessionEnrichment.jsonl');

  try {
    writeJsonlFile(outFile, rows, { trailingNewline: true });
    const result = await legacy.agentopsCustomImport(outFile, {
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
      sidecar_file: sidecarFile,
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
        script: row.attributes?.['agentops.script.name'] || '',
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
  if (options.subcommand === 'export-content') {
    if (!options.sessionId && !options.file) throw new Error('copilot-session export-content requires <session-id> or --file <events.jsonl>');
    if (!options.allowContent || !options.synthetic) throw new Error('copilot-session export-content requires --allow-content --synthetic');
    const eventsFile = options.file || defaultSessionEventsPath(options.sessionId);
    const sessionId = options.sessionId || path.basename(path.dirname(eventsFile));
    const result = writeSessionContent(readCopilotSessionEvents(eventsFile), sessionId, options.output, options.runId || sessionId);
    writeJsonOrRender({ ok: true, session_id: sessionId, ...result }, options.json, value => `Synthetic content rows: ${value.rows} in ${value.output}\n`);
    return;
  }
  if (options.subcommand === 'view') {
    if (!options.sessionId && !options.file) throw new Error('copilot-session view requires <session-id> or --file <events.jsonl>');
    if (!options.allowContent) throw new Error('copilot-session view includes prompts and tool payloads; pass --allow-content for an approved local session');
    const eventsFile = options.file || defaultSessionEventsPath(options.sessionId);
    const sessionId = options.sessionId || path.basename(path.dirname(eventsFile));
    const native = readSessionOtelSpans(sessionId, options.otelFiles.length ? options.otelFiles : defaultReceiptFiles(), { runId: options.runId });
    const output = writeSessionWaterfall(readCopilotSessionEvents(eventsFile), sessionId, options.output, { nativeSpans: native.spans });
    writeJsonOrRender({ ok: true, session_id: sessionId, output, native_spans: native.spans.filter(span => span.match === 'exact-session').length, run_linked_script_spans: native.spans.filter(span => span.match === 'run-linked-script').length, native_receipt_files: native.files.length, invalid_native_records: native.invalid }, options.json, result => `Local waterfall: ${result.output} · ${result.native_spans} native OTel spans · ${result.run_linked_script_spans} run-linked script spans\n`);
    return;
  }
  const result = await buildCopilotSessionEnrichment(options);
  writeJsonOrRender(result, options.json, renderCopilotSessionEnrichment);
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = {
  buildCopilotSessionEnrichment,
  copilotSessionCommand,
  parseCopilotSessionArgs,
  renderCopilotSessionEnrichment
};
