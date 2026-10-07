const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { CSP, allowedHost, createUiServer, loadAssets } = require('../src/lib/ui/server');
const { FAILED_ID, LEDGER_ONLY_ID, SECRETS, createUiFixture } = require('./support/ui-fixture');

function request(port, pathname, { method = 'GET', host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { Host: host } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function startFixtureServer(t, options = {}) {
  const fixture = createUiFixture(options.name || 'server');
  const ui = createUiServer({ copilotHome: fixture.copilotHome, agentOpsHome: fixture.agentOpsHome, ...options });
  const { port, url } = await ui.listen(0);
  t.after(async () => {
    await ui.close();
    fixture.cleanup();
  });
  return { ui, port, url, fixture };
}

test('ui server: smoke test serves the shell, assets and runs API on a free loopback port', async t => {
  const { ui, port, url } = await startFixtureServer(t);
  assert.ok(port > 0);
  assert.equal(url, `http://127.0.0.1:${port}/`);
  assert.equal(ui.server.address().address, '127.0.0.1');

  const home = await request(port, '/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /text\/html/);
  assert.equal(home.headers['content-security-policy'], CSP);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.match(home.body, /<script src="\/assets\/app\.js" defer><\/script>/);
  assert.doesNotMatch(home.body, /https?:\/\/(?!www\.w3\.org)/, 'no CDN or remote assets');

  for (const asset of ['/assets/app.js', '/assets/app.css', '/assets/favicon.svg', '/index.html']) {
    assert.equal((await request(port, asset)).status, 200, asset);
  }
  const head = await request(port, '/assets/app.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');

  const runs = await request(port, '/api/runs');
  assert.equal(runs.status, 200);
  assert.equal(runs.headers['cache-control'], 'no-store');
  const payload = runs.json();
  assert.equal(payload.runs.length, 3);
  assert.equal(payload.allowContent, false);
  assert.match(payload.pricing.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(payload.pricing.models.includes('claude-haiku-4.5'));
  for (const secret of SECRETS) assert.equal(runs.body.includes(secret), false, secret);
});

test('ui server: run detail, filters and errors', async t => {
  const { port } = await startFixtureServer(t, { name: 'routes' });
  const filtered = (await request(port, '/api/runs?status=attention&q=bash')).json();
  assert.deepEqual(filtered.runs.map(run => run.id), [FAILED_ID]);

  const detail = await request(port, `/api/runs/${FAILED_ID}`);
  assert.equal(detail.status, 200);
  const body = detail.json();
  assert.deepEqual(body.failures, []);
  assert.equal(body.attention[0].message, '1 tool call denied: bash');
  assert.ok(body.spans.length > 5);
  for (const secret of SECRETS) assert.equal(detail.body.includes(secret), false, secret);

  assert.equal((await request(port, '/api/runs/latest')).json().run.id, FAILED_ID);
  const since = await request(port, '/api/runs?since=365d');
  assert.equal(since.status, 200);
  assert.equal(typeof since.json().kpis.costLabel, 'string');
  assert.equal(since.json().window.since, '365d', 'the window label is echoed for the UI');
  assert.equal(since.json().window.capped, false);
  assert.equal((await request(port, '/api/runs')).json().window, null);
  const copilotOnly = (await request(port, '/api/runs?source=copilot')).json();
  assert.ok(copilotOnly.runs.length > 0);
  assert.ok(copilotOnly.runs.every(run => run.source !== 'ledger'));
  const ledgerOnly = (await request(port, '/api/runs?source=ledger')).json();
  assert.ok(ledgerOnly.runs.length > 0);
  assert.ok(ledgerOnly.runs.every(run => run.source === 'ledger'));
  const badSince = await request(port, '/api/runs?since=forever');
  assert.equal(badSince.status, 400);
  assert.equal(badSince.json().error, 'bad-since');
  assert.equal((await request(port, '/api/runs/missing')).status, 404);
  assert.equal((await request(port, '/api/runs/%E0%A4%A')).status, 400);
  assert.equal((await request(port, '/api/runs/..%2F..%2Fetc')).status, 404);
  assert.equal((await request(port, '/nope')).status, 404);

  const content = await request(port, `/api/runs/${FAILED_ID}/content`);
  assert.equal(content.status, 403);
  assert.equal(content.json().error, 'content-disabled');
});

test('ui server: rejects foreign Host headers and non-read methods', async t => {
  const { port } = await startFixtureServer(t, { name: 'guards' });
  const rebinding = await request(port, '/api/runs', { host: `evil.example:${port}` });
  assert.equal(rebinding.status, 403);
  assert.equal(rebinding.json().error, 'forbidden-host');
  assert.equal((await request(port, '/', { host: '127.0.0.1:1' })).status, 403);
  assert.equal((await request(port, '/', { host: `localhost:${port}` })).status, 200);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal((await request(port, '/api/runs', { method })).status, 405, method);
  }
});

test('ui server: content route serves redacted local content only with allowContent', async t => {
  const { port } = await startFixtureServer(t, { name: 'content', allowContent: true });
  const runs = (await request(port, '/api/runs')).json();
  assert.equal(runs.allowContent, true);
  const content = await request(port, `/api/runs/${FAILED_ID}/content`);
  assert.equal(content.status, 200);
  assert.match(content.json().tools.toolu_ok.arguments, /ARG_CANARY_91bc/);
  assert.equal((await request(port, `/api/runs/${LEDGER_ONLY_ID}/content`)).status, 404);
});

test('ui server: internal errors return a generic 500', async t => {
  const store = { allowContent: false, list: async () => { throw Object.assign(new Error('boom /Users/x'), { code: 'EBOOM' }); } };
  const ui = createUiServer({ store });
  const { port } = await ui.listen(0);
  t.after(() => ui.close());
  const response = await request(port, '/api/runs');
  assert.equal(response.status, 500);
  assert.deepEqual(response.json(), { error: 'internal-error', message: 'EBOOM' });
});

test('ui server: helpers', () => {
  assert.equal(allowedHost('127.0.0.1:5', 5), true);
  assert.equal(allowedHost('[::1]:5', 5), true);
  assert.equal(allowedHost('LOCALHOST:5', 5), true);
  assert.equal(allowedHost('127.0.0.1', 5), false);
  assert.equal(allowedHost(undefined, 5), false);
  const assets = loadAssets();
  assert.equal(assets.size, 5);
  const js = assets.get('/assets/app.js').body.toString('utf8');
  assert.doesNotMatch(js, /innerHTML|eval\(|new Function/, 'client renders with textContent only');
  assert.match(CSP, /default-src 'none'/);
});
