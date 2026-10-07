const fs = require('node:fs');
const path = require('node:path');

const { hasFlag, optionValue } = require('./args');
const { buildDigest, parsePeriod } = require('./digest/digest-summary');
const { loadPriceTable } = require('./cost-estimate');
const { renderDigestHtml } = require('./digest/render-html');
const { renderDigestMarkdown } = require('./digest/render-markdown');
const { readLocalSessions } = require('./digest/session-metadata');

const FORMATS = new Set(['md', 'html', 'json']);

function digestFormat(args) {
  if (hasFlag(args, '--json')) return 'json';
  const explicit = optionValue(args, '--format');
  if (explicit) {
    const format = explicit === 'markdown' ? 'md' : explicit;
    if (!FORMATS.has(format)) throw new Error('--format must be md, html or json');
    return format;
  }
  const output = optionValue(args, '--output');
  const extension = output ? path.extname(output).toLowerCase() : '';
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.json') return 'json';
  return 'md';
}

function renderDigest(digest, format) {
  if (format === 'json') return `${JSON.stringify(digest, null, 2)}\n`;
  if (format === 'html') return renderDigestHtml(digest);
  return renderDigestMarkdown(digest);
}

function generateDigest(args = [], options = {}) {
  const period = parsePeriod(optionValue(args, '--since', '7d'));
  const nowMs = options.nowMs ?? Date.now();
  const prices = loadPriceTable(optionValue(args, '--prices'));
  const read = readLocalSessions({
    copilotHome: optionValue(args, '--copilot-home') || undefined,
    agentopsHome: optionValue(args, '--agentops-home') || undefined,
    sinceMs: nowMs - 2 * period.periodMs,
    repoNames: hasFlag(args, '--repo-names')
  });
  return buildDigest({
    sessions: read.sessions,
    nowMs,
    period,
    prices,
    sources: {
      sessionsScanned: read.stats.scanned,
      sessionsSkippedAsOlder: read.stats.skippedOld,
      malformedRows: read.stats.malformedRows,
      linkedRuns: read.stats.linkedRuns,
      ledgerRuns: read.ledgerRuns,
      repoLabels: hasFlag(args, '--repo-names') ? 'basename' : 'hashed'
    }
  });
}

function digestCommand(args = [], io = {}) {
  const stdout = io.stdout || process.stdout;
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    stdout.write(`${DIGEST_HELP}\n`);
    return null;
  }
  const format = digestFormat(args);
  const digest = generateDigest(args, io);
  const body = renderDigest(digest, format);
  const output = optionValue(args, '--output');
  if (output) {
    const target = path.resolve(output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    stdout.write(`${digest.failureClusters.headline}; ${digest.current.sessions} session(s) in the last ${digest.period.label}.\nWrote ${format} digest: ${target}\n`);
  } else {
    stdout.write(body);
  }
  return digest;
}

const DIGEST_HELP = `agentops digest [--since 7d] [--format md|html|json] [--output <file>] [--prices <file.json>] [--repo-names] [--copilot-home <path>] [--agentops-home <path>]

Weekly summary of local Copilot CLI sessions: success/failure, failure clusters,
slowest tools (p95), tokens by model, estimated cost and the trend against the
previous period of the same length. Metadata only: prompts, tool arguments,
results and error messages are never copied into the report.`;

module.exports = {
  DIGEST_HELP,
  digestCommand,
  digestFormat,
  generateDigest,
  renderDigest
};
