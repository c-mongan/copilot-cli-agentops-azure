const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { openBrowser, parseUiArgs, shouldOpen, startUi, uiCommand, uiUsage } = require('../src/lib/ui-command');
const { openCommand } = require('../src/lib/open-command');
const { FAILED_ID, RUN_ID, createUiFixture } = require('./support/ui-fixture');

function capture() {
  let text = '';
  return { stream: { write: chunk => { text += chunk; return true; }, isTTY: false }, text: () => text };
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

test('ui command: parses flags, targets and rejects bad input', () => {
  assert.deepEqual(parseUiArgs([]), { target: null, port: 0, limit: 100, open: null, allowContent: false, help: false, copilotHome: null, agentOpsHome: null });
  const parsed = parseUiArgs(['latest', '--port', '4000', '--limit=25', '--open', '--allow-content', '--copilot-home', 'c', '--agentops-home=a', '--ui']);
  assert.equal(parsed.target, 'latest');
  assert.equal(parsed.port, 4000);
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.open, true);
  assert.equal(parsed.allowContent, true);
  assert.equal(parsed.copilotHome, 'c');
  assert.equal(parsed.agentOpsHome, 'a');
  assert.equal(parseUiArgs(['--no-open']).open, false);
  assert.equal(parseUiArgs(['-h']).help, true);
  assert.throws(() => parseUiArgs(['--port']), /--port requires a value/);
  assert.throws(() => parseUiArgs(['--port', '70000']), /--port must be/);
  assert.throws(() => parseUiArgs(['--limit', '0']), /--limit must be/);
  assert.throws(() => parseUiArgs(['--bogus']), /Unknown option/);
  assert.throws(() => parseUiArgs(['a', 'b']), /Unexpected argument/);
  assert.throws(() => parseUiArgs(['../x']), /unsupported characters/);
  assert.match(uiUsage(), /agentops ui \[latest/);
  assert.match(uiUsage(), /--allow-content/);
});

test('ui command: opens the browser only for interactive terminals unless forced', () => {
  assert.equal(shouldOpen(true, { stdout: {}, env: {} }), true);
  assert.equal(shouldOpen(false, { stdout: { isTTY: true }, env: {} }), false);
  assert.equal(shouldOpen(null, { stdout: { isTTY: true }, env: {} }), true);
  assert.equal(shouldOpen(null, { stdout: { isTTY: true }, env: { CI: 'true' } }), false);
  assert.equal(shouldOpen(null, { stdout: { isTTY: false }, env: {} }), false);

  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, ...args]);
    return { on() {}, unref() {} };
  };
  assert.equal(openBrowser('http://127.0.0.1:1/', { platform: 'darwin', spawn }), true);
  assert.equal(openBrowser('http://127.0.0.1:1/', { platform: 'linux', spawn }), true);
  assert.equal(openBrowser('http://127.0.0.1:1/', { platform: 'win32', spawn }), true);
  assert.deepEqual(calls, [
    ['open', 'http://127.0.0.1:1/'],
    ['xdg-open', 'http://127.0.0.1:1/'],
    ['cmd', '/c', 'start', '', 'http://127.0.0.1:1/']
  ]);
  assert.equal(openBrowser('x', { platform: 'linux', spawn: () => { throw new Error('ENOENT'); } }), false);
});

test('ui command: starts on a free port, deep-links a target and prints the URL', async t => {
  const fixture = createUiFixture('command');
  t.after(fixture.cleanup);
  const out = capture();
  const opened = [];
  const ui = await uiCommand(['latest', '--open', '--copilot-home', fixture.copilotHome, '--agentops-home', fixture.agentOpsHome], {
    stdout: out.stream,
    openBrowser: url => { opened.push(url); return true; },
    keepAlive: false
  });
  t.after(() => ui.close());
  assert.match(ui.url, new RegExp(`^http://127\\.0\\.0\\.1:\\d+/#/run/${FAILED_ID}$`));
  assert.deepEqual(opened, [ui.url]);
  assert.match(out.text(), /AgentOps UI running at http:\/\/127\.0\.0\.1:\d+\//);
  assert.match(out.text(), /Metadata only/);
  assert.equal(await get(ui.url.replace(/#.*$/, '')), 200);
});

test('ui command: unknown targets fall back to the runs list and failed opens are reported', async t => {
  const fixture = createUiFixture('fallback');
  t.after(fixture.cleanup);
  const out = capture();
  const ui = await startUi({ target: 'no-such-session', open: true, allowContent: true, copilotHome: fixture.copilotHome, agentOpsHome: fixture.agentOpsHome }, {
    stdout: out.stream,
    openBrowser: () => false
  });
  t.after(() => ui.close());
  assert.match(ui.url, /\/$/);
  assert.match(out.text(), /No local session or run matches "no-such-session"/);
  assert.match(out.text(), /Content mode/);
  assert.match(out.text(), /Could not open a browser automatically/);
});

test('ui command: help prints usage without starting a server', async () => {
  const out = capture();
  assert.equal(await uiCommand(['--help'], { stdout: out.stream }), null);
  assert.match(out.text(), /Starts a local, read-only web UI/);
});

test('ui command: agentops open <run> --ui delegates to the UI', async t => {
  const fixture = createUiFixture('open');
  t.after(fixture.cleanup);
  const out = capture();
  const ui = await openCommand([RUN_ID, '--ui', '--no-open', '--copilot-home', fixture.copilotHome, '--agentops-home', fixture.agentOpsHome], { stdout: out.stream, keepAlive: false });
  t.after(() => ui.close());
  assert.match(ui.url, new RegExp(`#/run/${FAILED_ID}$`));
});
