const assert = require('node:assert/strict');
const test = require('node:test');

test('CLI surface exposes public command lists and help text', () => {
  const { coreCommands, experimentalCommands, usage } = require('../src/lib/cli-surface');

  assert.ok(coreCommands.includes('collector'));
  assert.ok(coreCommands.includes('triage'));
  assert.ok(experimentalCommands.has('benchmark'));
  assert.ok(experimentalCommands.has('saved-view'));

  const help = usage();
  assert.match(help, /collector start\|stop\|status\|validate\|smoke\|install-binary\|uninstall-binary/);
  assert.match(help, /agentops experimental <old-command>/);
  assert.doesNotMatch(help, /benchmark list/);
});

test('usage(topic) returns every matching command line with its description lines', () => {
  const { usage: surfaceUsage } = require('../src/lib/cli-surface');
  const exportOtel = surfaceUsage('copilot-session export-otel');
  for (const option of ['--run-id', '--endpoint', '--appinsights-connection-string-env', '--output', '--dry-run', '--force', '--agent-name', '--otel-file', '--json']) {
    assert.ok(exportOtel.includes(option), `export-otel help lists ${option}`);
  }
  assert.match(exportOtel, /\n {2}Sends OpenTelemetry GenAI semconv spans/);
  const session = surfaceUsage('copilot-session');
  for (const subcommand of ['enrich', 'launch', 'view', 'export-spans', 'export-otel', 'export-events', 'collect', 'export-content', 'delete-content']) {
    assert.match(session, new RegExp(`^agentops copilot-session ${subcommand} `, 'm'));
  }
  assert.doesNotMatch(session, /^agentops (?!copilot-session )/m);
});

test('agentops --version and copilot-session export-otel --help succeed from the CLI entry point', () => {
  const { spawnSync } = require('node:child_process');
  const pathModule = require('node:path');
  const entry = pathModule.join(__dirname, '..', 'src', 'index.js');
  const version = spawnSync(process.execPath, [entry, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, `${require('../package.json').version}\n`);
  const help = spawnSync(process.execPath, [entry, 'copilot-session', 'export-otel', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^agentops copilot-session export-otel <session-id> --run-id <id>/);
  assert.equal(help.stderr, '');
});
