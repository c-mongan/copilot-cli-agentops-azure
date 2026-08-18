const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { writeBrowserNotes } = require('../src/lib/e2e-browser-notes');

test('e2e browser notes summarize static checks Grafana status and auth remediation', () => {
  const notesPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-browser-notes-')), 'browser-notes.md');

  writeBrowserNotes(notesPath, {
    reportPath: '/tmp/agentops-report.html',
    static: {
      ok: false,
      passVisible: false,
      secretLooking: true,
      grafanaLinks: 2,
      evidenceLinks: 1
    },
    playwright: {
      status: 'checked',
      reason: 'manual verification requested',
      reportScreenshot: '/tmp/report.png',
      browserProfile: { persistent: true, storageState: false },
      requireGrafanaVisible: true,
      grafana: [
        { label: 'AgentOps V2 Home', dashboardVisible: true, authBlocked: false, url: 'https://grafana.example/d/home' },
        { label: 'V2 Runs Explorer', dashboardVisible: false, authBlocked: true, url: 'https://grafana.example/d/runs' },
        { label: 'V2 Run Story', dashboardVisible: false, authBlocked: false, url: 'https://grafana.example/d/replay' }
      ],
      authRemediation: {
        reason: 'Azure Managed Grafana redirected to Microsoft sign-in.',
        sign_in_once: ['sign-in-command'],
        verify_after_sign_in: ['verify-command']
      }
    }
  });

  const notes = fs.readFileSync(notesPath, 'utf8');
  assert.match(notes, /# Browser Validation Notes/);
  assert.match(notes, /- Static report check: fail/);
  assert.match(notes, /- PASS visible: no/);
  assert.match(notes, /- Secret-looking values: yes/);
  assert.match(notes, /- Browser profile: persistent profile/);
  assert.match(notes, /AgentOps V2 Home: visible/);
  assert.match(notes, /V2 Runs Explorer: auth-blocked/);
  assert.match(notes, /V2 Run Story: not verified/);
  assert.match(notes, /Required visible dashboards: failed/);
  assert.match(notes, /## Auth Remediation/);
  assert.match(notes, /sign-in-command/);
  assert.match(notes, /verify-command/);
});
