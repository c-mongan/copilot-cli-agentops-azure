const {
  compactNumber,
  costLabel,
  day,
  duration,
  glanceRows,
  listPreview,
  stamp,
  usd
} = require('./format');

const MAX_CLUSTERS = 12;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// Turns `code` spans in plain-text actions into <code> after escaping.
function inlineCode(text) {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

const TYPE_TONE = {
  denied: 'amber',
  blocked: 'amber',
  timeout: 'red',
  rate_limited: 'red',
  nonzero_exit: 'blue',
  unknown_tool: 'violet',
  invalid_input: 'violet',
  not_found: 'slate'
};

function kpiCards(digest) {
  return glanceRows(digest).map(row => `
      <article class="kpi">
        <h3>${escapeHtml(row.metric)}</h3>
        <p class="kpi-value">${escapeHtml(row.now)}</p>
        <p class="kpi-meta"><span class="chip tone-${row.change.tone}">${escapeHtml(row.change.text)}</span> <span class="muted">was ${escapeHtml(row.before)}</span></p>
        ${row.hint ? `<p class="kpi-hint">${escapeHtml(row.hint)}</p>` : ''}
      </article>`).join('');
}

function actionList(digest) {
  return digest.recommendations.map((action, index) => `
        <li><span class="step">${index + 1}</span><span>${action.title
    ? `<strong class="action-title">${escapeHtml(action.title)}</strong> <span class="chip tone-neutral">${escapeHtml(action.detail)}</span><br>${inlineCode(action.body)}`
    : inlineCode(action.text)}</span></li>`).join('');
}

function clusterCards(digest) {
  const { clusters } = digest.failureClusters;
  if (!clusters.length) return '<p class="empty">No failed tool calls in this period. 🎉</p>';
  const max = clusters[0].count;
  const shown = clusters.slice(0, MAX_CLUSTERS).map(cluster => `
        <article class="cluster">
          <header>
            <span class="tool">${escapeHtml(cluster.tool)}</span>
            <span class="chip tone-${TYPE_TONE[cluster.errorType] || 'slate'}">${escapeHtml(cluster.errorType)}</span>
            <span class="chip tone-neutral">${escapeHtml(cluster.model)}</span>
            <span class="count">${cluster.count}<small>×</small></span>
          </header>
          <div class="bar"><span style="width:${Math.max(2, Math.round((cluster.count / max) * 100))}%"></span></div>
          <dl>
            <div><dt>Runs</dt><dd>${cluster.runCount}</dd></div>
            <div><dt>Repos</dt><dd>${cluster.repos.length}</dd></div>
            <div><dt>First seen</dt><dd>${escapeHtml(stamp(cluster.firstSeen))}</dd></div>
            <div><dt>Last seen</dt><dd>${escapeHtml(stamp(cluster.lastSeen))}</dd></div>
          </dl>
          <p class="repos" title="Repository labels">${escapeHtml(listPreview(cluster.repos, 4))}</p>
          <p class="example">Example run <code>${escapeHtml(cluster.representativeRunId)}</code></p>
          <p class="next">${inlineCode(cluster.suggestedNextStep)}</p>
        </article>`).join('');
  const more = clusters.length > MAX_CLUSTERS
    ? `<p class="muted">${clusters.length - MAX_CLUSTERS} smaller cluster(s) omitted; use <code>--format json</code> for all of them.</p>`
    : '';
  return `${shown}${more}`;
}

function toolBars(digest) {
  if (!digest.slowestTools.length) return '<p class="empty">No completed tool calls in this period.</p>';
  const max = Math.max(...digest.slowestTools.map(tool => tool.p95Ms), 1);
  return digest.slowestTools.map(tool => `
        <div class="hbar">
          <span class="hbar-label">${escapeHtml(tool.tool)}<small>${tool.calls} calls · p50 ${escapeHtml(duration(tool.p50Ms))}</small></span>
          <span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(2, Math.round((tool.p95Ms / max) * 100))}%"></span><span class="hbar-p50" style="left:${Math.min(100, Math.round((tool.p50Ms / max) * 100))}%"></span></span>
          <span class="hbar-value">${escapeHtml(duration(tool.p95Ms))}</span>
        </div>`).join('');
}

function tokenTable(digest) {
  const { tokens } = digest.current;
  if (!tokens.models.length) return '<p class="empty">No token usage reported in this period.</p>';
  const rows = tokens.models.map(model => `
          <tr>
            <td>${escapeHtml(model.model)}</td>
            <td class="num">${model.sessions}</td>
            <td class="num">${compactNumber(model.inputTokens)}</td>
            <td class="num">${compactNumber(model.outputTokens)}</td>
            <td class="num">${compactNumber(model.cacheReadTokens)}</td>
            <td class="num ${model.estCostUsd === null ? 'muted' : ''}">${escapeHtml(usd(model.estCostUsd))}</td>
          </tr>`).join('');
  return `
        <table>
          <thead><tr><th>Model</th><th class="num">Sessions</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache read</th><th class="num">Cost</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>Total</td><td></td><td class="num">${compactNumber(tokens.inputTokens)}</td><td class="num">${compactNumber(tokens.outputTokens)}</td><td class="num">${compactNumber(tokens.models.reduce((sum, model) => sum + model.cacheReadTokens, 0))}</td><td class="num">${escapeHtml(costLabel(tokens))}</td></tr></tfoot>
        </table>${tokens.costStatus === 'partial' ? `
        <p class="muted note">Partial estimate: no price is known for ${escapeHtml(tokens.unpricedModels.join(', '))}. Pass <code>--prices &lt;file.json&gt;</code> to price them.</p>` : ''}`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7fb;--panel:#fff;--ink:#141a2a;--muted:#5d667c;--line:#e3e6ef;--accent:#4f46e5;--accent-soft:#eef0ff;--good:#0f7b4f;--good-bg:#e3f6ec;--bad:#b42318;--bad-bg:#fdecea;--amber:#9a5b00;--amber-bg:#fff3d6;--red:#b42318;--red-bg:#fdecea;--blue:#1d5fd1;--blue-bg:#e6efff;--violet:#6d3fd1;--violet-bg:#f0e9ff;--slate:#465066;--slate-bg:#eceff5;--neutral-bg:#f0f2f7;--shadow:0 1px 2px rgba(16,24,40,.06),0 4px 16px rgba(16,24,40,.05)}
:root[data-theme=dark]{--bg:#0d1117;--panel:#161b26;--ink:#e7ebf3;--muted:#98a2b8;--line:#262e3e;--accent:#8b8cff;--accent-soft:#23264a;--good:#4ade80;--good-bg:#11301f;--bad:#ff8a80;--bad-bg:#3a1714;--amber:#ffc561;--amber-bg:#3a2a0b;--red:#ff8a80;--red-bg:#3a1714;--blue:#7fb0ff;--blue-bg:#14284d;--violet:#c4a8ff;--violet-bg:#2a1d4d;--slate:#b6c0d4;--slate-bg:#232b3b;--neutral-bg:#212838;--shadow:none}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d1117;--panel:#161b26;--ink:#e7ebf3;--muted:#98a2b8;--line:#262e3e;--accent:#8b8cff;--accent-soft:#23264a;--good:#4ade80;--good-bg:#11301f;--bad:#ff8a80;--bad-bg:#3a1714;--amber:#ffc561;--amber-bg:#3a2a0b;--red:#ff8a80;--red-bg:#3a1714;--blue:#7fb0ff;--blue-bg:#14284d;--violet:#c4a8ff;--violet-bg:#2a1d4d;--slate:#b6c0d4;--slate-bg:#232b3b;--neutral-bg:#212838;--shadow:none}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 28px 40px}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--neutral-bg);padding:1px 6px;border-radius:6px;word-break:break-all}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}
.top h1{margin:0;font-size:24px;letter-spacing:-.01em}.top p{margin:4px 0 0;color:var(--muted)}
.badges{display:flex;gap:8px;align-items:center}
.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-weight:600;font-size:12px}
button.theme{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer}
.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}
.kpi,.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow)}
.kpi{padding:14px 16px}.kpi h3{margin:0;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.kpi-value{margin:6px 0 6px;font-size:20px;font-weight:700;line-height:1.25}
.kpi-meta,.kpi-hint{margin:0;font-size:12px}.kpi-hint{margin-top:6px;color:var(--muted)}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.tone-good{background:var(--good-bg);color:var(--good)}.tone-bad{background:var(--bad-bg);color:var(--bad)}.tone-neutral{background:var(--neutral-bg);color:var(--muted)}
.tone-amber{background:var(--amber-bg);color:var(--amber)}.tone-red{background:var(--red-bg);color:var(--red)}.tone-blue{background:var(--blue-bg);color:var(--blue)}.tone-violet{background:var(--violet-bg);color:var(--violet)}.tone-slate{background:var(--slate-bg);color:var(--slate)}
.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:16px;align-items:start}
.panel{padding:18px 20px;margin-bottom:16px}.panel h2{margin:0 0 12px;font-size:16px}.panel h2 small{font-weight:500;color:var(--muted);margin-left:6px}
ol.actions{list-style:none;margin:0;padding:0;display:grid;gap:10px}
ol.actions li{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--neutral-bg)}
.step{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:#fff;font-weight:700;font-size:12px}
.clusters{display:grid;gap:10px}
.cluster{border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.cluster header{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cluster .tool{font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.cluster .count{margin-left:auto;font-size:18px;font-weight:700}.cluster .count small{font-size:12px;color:var(--muted);margin-left:1px}
.bar{height:6px;background:var(--neutral-bg);border-radius:999px;margin:8px 0;overflow:hidden}.bar span{display:block;height:100%;background:var(--accent);border-radius:999px}
.cluster dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0}
.cluster dt{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.cluster dd{margin:0;font-size:13px;overflow-wrap:anywhere}
.repos{margin:6px 0 0;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--muted)}.action-title{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.example{margin:8px 0 4px;font-size:12px;color:var(--muted)}.next{margin:0;font-size:13px}
.hbar{display:grid;grid-template-columns:minmax(0,190px) minmax(0,1fr) 72px;gap:12px;align-items:center;padding:6px 0}
.hbar-label{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hbar-label small{display:block;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--muted);font-size:11px}
.hbar-track{position:relative;height:10px;background:var(--neutral-bg);border-radius:999px}
.hbar-fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,var(--accent),var(--violet));border-radius:999px}
.hbar-p50{position:absolute;top:-3px;width:2px;height:16px;background:var(--ink);opacity:.55}
.hbar-value{text-align:right;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:13px}td:first-child{white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}.note{margin:10px 0 0;font-size:12px}th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left}
th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}tfoot td{font-weight:700;border-bottom:none}
.num{text-align:right;font-variant-numeric:tabular-nums}
.empty{color:var(--muted);margin:0}
footer{color:var(--muted);font-size:12px;margin-top:8px}footer p{margin:4px 0}
@media (max-width:980px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}.cluster dl{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

const SCRIPT = `
(function(){const root=document.documentElement;const param=new URLSearchParams(location.search).get('theme');
if(param==='dark'||param==='light')root.setAttribute('data-theme',param);
const button=document.getElementById('theme');if(!button)return;
button.addEventListener('click',function(){const dark=root.getAttribute('data-theme')==='dark'||(!root.getAttribute('data-theme')&&matchMedia('(prefers-color-scheme: dark)').matches);root.setAttribute('data-theme',dark?'light':'dark');});})();
`;

function renderDigestHtml(digest) {
  const { period, failureClusters: clusters } = digest;
  const sources = digest.sources || {};
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>AgentOps digest · last ${escapeHtml(period.label)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <section class="top">
    <div>
      <h1>AgentOps digest · last ${escapeHtml(period.label)}</h1>
      <p>${escapeHtml(day(period.start))} → ${escapeHtml(day(period.end))}, compared with ${escapeHtml(day(period.previousStart))} → ${escapeHtml(day(period.previousEnd))}</p>
    </div>
    <div class="badges">
      <span class="pill" title="No prompts, tool arguments, results or error messages are read into this report.">🔒 Metadata only</span>
      <button class="theme" id="theme" type="button">Light / dark</button>
    </div>
  </section>
  <section class="kpis">${kpiCards(digest)}
  </section>
  <section class="grid">
    <div>
      <section class="panel">
        <h2>Top actions</h2>
        <ol class="actions">${actionList(digest)}
        </ol>
      </section>
      <section class="panel">
        <h2>Slowest tools <small>p95 bar, p50 tick</small></h2>${toolBars(digest)}
      </section>
    </div>
    <section class="panel">
      <h2>Failure clusters <small>${escapeHtml(clusters.headline)}</small></h2>
      <div class="clusters">${clusterCards(digest)}
      </div>
    </section>
  </section>
  <section class="panel">
    <h2>Tokens by model <small>input includes cache reads; resumed sessions and repeated events counted once</small></h2>${tokenTable(digest)}
  </section>
  <footer>
    <p>Sources: ${Number(sources.sessionsScanned || 0)} local Copilot CLI session file(s) scanned, ${Number(sources.linkedRuns || 0)} linked to AgentOps runs. Generated ${escapeHtml(stamp(digest.generatedAt))} UTC by <code>agentops digest</code>.</p>
    <p>Cost: ${escapeHtml(digest.priceTable || 'no price table')}. "n/a" means no price is known for that model; totals count those models as unpriced instead of guessing.</p>
  </footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

module.exports = {
  escapeHtml,
  renderDigestHtml
};
