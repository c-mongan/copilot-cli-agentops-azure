const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { RunStore } = require('./data');
const { PRICE_TABLE_DATE, PRICE_TABLE_SOURCES, PRICES } = require('./pricing');

const ASSET_DIR = path.join(__dirname, 'assets');
const ASSETS = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/assets/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/assets/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/assets/favicon.svg': { file: 'favicon.svg', type: 'image/svg+xml' }
};
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

function loadAssets(dir = ASSET_DIR) {
  const assets = new Map();
  for (const [route, asset] of Object.entries(ASSETS)) {
    assets.set(route, { type: asset.type, body: fs.readFileSync(path.join(dir, asset.file)) });
  }
  return assets;
}

function send(res, status, type, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...extraHeaders
  });
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

function sendJson(res, status, value) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value), { 'Cache-Control': 'no-store' });
}

// DNS-rebinding guard: a page on another origin that resolves to 127.0.0.1 still
// sends its own Host header, so only loopback hosts on our port are served.
function allowedHost(hostHeader, port) {
  if (typeof hostHeader !== 'string') return false;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(hostHeader.toLowerCase());
}

function pricingInfo() {
  return {
    date: PRICE_TABLE_DATE,
    sources: PRICE_TABLE_SOURCES,
    models: Object.keys(PRICES).sort()
  };
}

function createUiServer(options = {}) {
  const store = options.store || new RunStore(options);
  const assets = options.assets || loadAssets(options.assetDir);
  const state = { port: 0 };

  const handle = async (req, res) => {
    if (!allowedHost(req.headers.host, state.port)) return sendJson(res, 403, { error: 'forbidden-host' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'read-only' });
    const url = new URL(req.url, `http://127.0.0.1:${state.port}`);
    const route = url.pathname;

    const asset = assets.get(route);
    if (asset) return send(res, 200, asset.type, asset.body, { 'Cache-Control': 'no-cache' });

    if (route === '/api/runs') {
      const filters = {};
      for (const key of ['model', 'repo', 'status', 'q']) {
        const value = url.searchParams.get(key);
        if (value) filters[key] = value.slice(0, 200);
      }
      const result = await store.list(filters);
      return sendJson(res, 200, { ...result, pricing: pricingInfo() });
    }

    const match = /^\/api\/runs\/([^/]+)(\/content)?$/.exec(route);
    if (match) {
      let id;
      try { id = decodeURIComponent(match[1]); } catch { return sendJson(res, 400, { error: 'bad-id' }); }
      if (match[2]) {
        if (!store.allowContent) return sendJson(res, 403, { error: 'content-disabled', hint: 'Restart with: agentops ui --allow-content' });
        const content = await store.content(id);
        return content ? sendJson(res, 200, content) : sendJson(res, 404, { error: 'not-found' });
      }
      const detail = await store.detail(id);
      return detail ? sendJson(res, 200, { ...detail, pricing: pricingInfo() }) : sendJson(res, 404, { error: 'not-found' });
    }

    return sendJson(res, 404, { error: 'not-found' });
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal-error', message: String(error?.code || 'unexpected') });
      else res.destroy();
    });
  });

  return {
    server,
    store,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          state.port = server.address().port;
          resolve({ port: state.port, url: `http://127.0.0.1:${state.port}/` });
        });
      });
    },
    close() {
      return new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    }
  };
}

module.exports = {
  CSP,
  allowedHost,
  createUiServer,
  loadAssets
};
