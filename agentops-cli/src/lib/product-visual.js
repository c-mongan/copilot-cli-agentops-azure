const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson } = require('./json');

const requiredVisualDashboards = [
  'agentops-v2-home',
  'agentops-v2-runs-explorer',
  'agentops-v2-run-replay',
  'agentops-v2-models-cost-tokens',
  'agentops-v2-tools-mcp-risk',
  'agentops-v2-safety-privacy-policy',
  'agentops-v2-code-outcomes',
  'agentops-v2-evals-quality',
  'agentops-v2-insights-regressions',
  'agentops-v2-collector-health'
];

function visualAuditRecoveryCommands(reportPath) {
  return [
    'agentops e2e run --live --browser-report --last 2h --json',
    `agentops e2e report --last 2h --out ${reportPath}`,
    `agentops product audit --live --last 2h --require-rows --require-visual --report ${reportPath} --json`
  ];
}

function validateVisualEvidence(evidencePath) {
  const resolved = path.resolve(evidencePath || '');
  if (!evidencePath || !fs.existsSync(resolved)) {
    return {
      ok: false,
      evidencePath: resolved,
      dashboards: [],
      visible: [],
      missing: [`Visual evidence file not found: ${resolved}`]
    };
  }

  let payload;
  try {
    payload = readJson(resolved);
  } catch (error) {
    return {
      ok: false,
      evidencePath: resolved,
      dashboards: [],
      visible: [],
      missing: [`Visual evidence file is not valid JSON: ${error.message}`]
    };
  }

  const dashboards = Array.isArray(payload.dashboards) ? payload.dashboards : [];
  const byUid = new Map(dashboards.map(item => [String(item.uid || ''), item]));
  const missing = [];
  const visible = [];
  for (const uid of requiredVisualDashboards) {
    const item = byUid.get(uid);
    if (!item) {
      missing.push(`${uid}: missing`);
      continue;
    }
    const screenshotPath = item.screenshot ? path.resolve(path.dirname(resolved), item.screenshot) : '';
    const screenshotOk = screenshotPath && fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).size > 1000;
    const screenshotHash = screenshotOk
      ? crypto.createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex')
      : '';
    if (item.authBlocked) missing.push(`${uid}: auth-blocked`);
    if (!item.dashboardVisible) missing.push(`${uid}: not visible`);
    if ((item.errors || []).length) missing.push(`${uid}: ${item.errors.join(', ')}`);
    if (!screenshotOk) missing.push(`${uid}: screenshot missing or too small`);
    if (item.sha256 && screenshotHash !== item.sha256) missing.push(`${uid}: screenshot hash mismatch`);
    if (!String(item.url || '').includes(`/d/${uid}`)) missing.push(`${uid}: URL does not match dashboard UID`);
    if (!item.authBlocked && item.dashboardVisible && !(item.errors || []).length && screenshotOk) visible.push(uid);
  }

  return {
    ok: missing.length === 0,
    evidencePath: resolved,
    dashboards,
    visible,
    missing
  };
}

module.exports = {
  requiredVisualDashboards,
  validateVisualEvidence,
  visualAuditRecoveryCommands
};
