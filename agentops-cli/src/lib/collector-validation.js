const http = require('node:http');
const https = require('node:https');
const {
  collectorHealthUrlWithSlash,
  otlpHttpEndpoint
} = require('./collector-endpoints');

function createCollectorValidation(dependencies = {}) {
  const { openLinksSummary } = dependencies;

  function renderOpenLinks(links = openLinksSummary()) {
    const lines = [
      'AgentOps investigation links',
      '',
      `${links.primary_investigation_label || 'Today'}: ${links.primary_investigation_url || links.v2_home_url}`,
      ...(links.azure_agents_view_url && links.primary_investigation_url !== links.azure_agents_view_url
        ? [`Azure Monitor Agents view: ${links.azure_agents_view_url}`]
        : []),
      `Advanced Grafana Today: ${links.v2_home_url}`,
      `Runs: ${links.v2_runs_url}`,
      `Run Story: ${links.v2_replay_url}`,
      `Main dashboard: ${links.main_dashboard_url}`,
      `Sessions dashboard: ${links.sessions_dashboard_url}`
    ];

    if (links.latest_session_url) {
      lines.push(`Latest session: ${links.latest_session_url}`);
    } else {
      lines.push(`Latest session: unknown. ${links.missing_latest_reason}.`);
    }

    return `${lines.join('\n')}\n`;
  }

  function httpHealthCheck(url, options = {}) {
    return new Promise(resolve => {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request(parsed, { method: 'GET', timeout: options.timeoutMs || 1500 }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({
          reachable: true,
          statusCode: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          body: body.slice(0, 200)
        }));
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ reachable: false, ok: false, error: 'timeout' });
      });
      req.on('error', error => resolve({ reachable: false, ok: false, error: error.message }));
      req.end();
    });
  }

  function validateCollector(endpoint = otlpHttpEndpoint, options = {}) {
    return new Promise((resolve) => {
      const url = new URL('/v1/traces', endpoint);
      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(url, { method: 'POST', timeout: 1500 }, res => {
        resolve({ endpoint, reachable: true, statusCode: res.statusCode, ok: res.statusCode < 500 });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ endpoint, reachable: false, ok: false, error: 'timeout' });
      });
      req.on('error', error => resolve({ endpoint, reachable: false, ok: false, error: error.message }));
      req.end();
    }).then(async otlpHttp => {
      const healthEndpoint = options.healthEndpoint || collectorHealthUrlWithSlash;
      const health = await httpHealthCheck(healthEndpoint, options);
      return {
        endpoint,
        otlp_http: otlpHttp,
        health_endpoint: healthEndpoint,
        health,
        ok: Boolean(otlpHttp.ok && health.ok)
      };
    });
  }

  return {
    renderOpenLinks,
    validateCollector
  };
}

module.exports = { createCollectorValidation };
