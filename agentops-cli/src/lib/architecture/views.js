const fs = require('node:fs');
const path = require('node:path');
const { renderSessionWaterfall } = require('../copilot/session-waterfall');

const escape = value => String(value === undefined || value === null || value === '' ? 'unknown' : value).slice(0, 2000).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const runAnchor = id => `run-${Buffer.from(String(id)).toString('hex')}`;
const eventAnchor = id => `event-${Buffer.from(String(id)).toString('hex')}`;
const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? escape(value) : 'unknown';
const link = (id, availableIds) => availableIds === undefined || availableIds.has(id)
  ? `<a href="runs.html#${runAnchor(id)}">${escape(id)}</a>`
  : `<span>${escape(id)} (evidence unavailable in this ledger)</span>`;
const eventLink = (id, availableIds) => availableIds === undefined || availableIds.has(id)
  ? `<a href="runs.html#${eventAnchor(id)}"><code>${escape(id)}</code></a>`
  : `<span><code>${escape(id)}</code> (evidence unavailable in this ledger)</span>`;
const identity = (value, values, status) => value || `${status || 'unknown'} (${(values || []).join(', ') || 'none recorded'})`;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><link rel="icon" href="data:,"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentOps ${title}</title><style>
  *{box-sizing:border-box}body{overflow-wrap:anywhere;margin:auto;max-width:1200px;padding:24px;background:#101827;color:#e8eef8;font:16px system-ui;line-height:1.5}a{color:#9dd8ff}nav{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:32px}h1{margin-bottom:8px}p{color:#bdcce0}article,section{padding:20px;margin:20px 0;background:#19263a;border:1px solid #455776;border-radius:10px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;text-align:left;border-bottom:1px solid #455776;overflow-wrap:anywhere}.scroll{overflow:auto}input,select{font:inherit;background:#19263a;color:#e8eef8;padding:10px;border:1px solid #809bbd;border-radius:6px;max-width:100%}:focus-visible{outline:3px solid #9dd8ff}label{display:block;margin:12px 0}small{color:#bdcce0}[hidden]{display:none!important}.tag{display:inline-block;padding:2px 8px;background:#30425d;border-radius:4px} @media(max-width:600px){body{padding:16px}article,section{padding:14px}td,th{padding:6px}}
  </style></head><body><nav aria-label="Product"><a href="runs.html" ${title === 'Runs' ? 'aria-current="page"' : ''}>Runs</a><a href="architecture.html" ${title === 'Architecture' ? 'aria-current="page"' : ''}>Architecture</a><a href="compare.html" ${title === 'Compare' ? 'aria-current="page"' : ''}>Compare</a></nav><main><h1>${title}</h1><p>Local metadata only. Unknown evidence stays unknown. Hypotheses require a protected experiment before a change.</p>${body}</main><script>
  const search=document.querySelector('#search'),status=document.querySelector('#status');function filter(){for(const card of document.querySelectorAll('[data-card]'))card.hidden=!(card.textContent.toLowerCase().includes((search?.value||'').toLowerCase())&&(!status||status.value==='all'||card.dataset.status===status.value));}search?.addEventListener('input',filter);status?.addEventListener('change',filter);
  function reveal(){const target=document.getElementById(location.hash.slice(1));if(target){if(search)search.value='';if(status)status.value='all';filter();for(let details=target.closest('details');details;details=details.parentElement?.closest('details'))details.open=true;target.scrollIntoView();}}addEventListener('hashchange',reveal);reveal();
  </script></body></html>`;
}

function renderArchitecture(report, options = {}) {
  const cards = report.cards.map(card => {
    const evidence = card.metricEvidence || {};
    const configuration = identity(evidence.configurationVersion, evidence.configurationVersions, evidence.coverage?.configurationVersionStatus);
    const task = identity(evidence.taskId, evidence.taskIds, evidence.coverage?.taskStatus);
    const evidenceIds = (evidence.evidenceIds || []).map(id => eventLink(id, options.availableEventIds)).join(' · ');
    return `<article data-card><h2>${escape(card.title || card.rule)}</h2><span class="tag">${escape(card.status || 'open')} hypothesis</span><p>${escape(card.summary)}</p><p>Evidence: ${measured(evidence.numerator)} / ${measured(evidence.denominator)} ${escape(evidence.unit || 'unknown')}.</p><p>Architecture: ${escape(evidence.architectureVersion || report.architectureVersion)} · Execution configuration: ${escape(configuration)} · Task: ${escape(task)}</p><p>Cohort ID: <code>${escape(evidence.cohortId)}</code></p><p>Coverage: ${measured(evidence.coverageRuns)} eligible runs · Complete evidence: ${measured(evidence.coverage?.evidenceCompleteRuns)} · Configuration coverage: ${escape(evidence.coverage?.configurationVersionStatus)} · Task coverage: ${escape(evidence.coverage?.taskStatus)}</p><p>Exact evidence IDs: ${evidenceIds || 'unknown'}</p><p>${(card.representativeRunIds || []).map(id => link(id, options.availableRunIds)).join(' · ') || 'No linked runs'}</p><p>Candidate change: ${escape(card.proposedChange)}</p><p>Rejection test: ${escape(card.rejectionTest)}</p></article>`;
  }).join('');
  const configuration = identity(report.configurationVersion, report.configurationVersions, report.configurationVersionStatus);
  const task = identity(report.taskId, report.taskIds, report.taskStatus);
  const cohorts = (report.cohorts || []).map(cohort => `<tr><td><code>${escape(cohort.cohortId)}</code></td><td>${escape(identity(cohort.configurationVersion, cohort.configurationVersions, cohort.configurationVersionStatus))}</td><td>${escape(identity(cohort.taskId, cohort.taskIds, cohort.taskStatus))}</td><td>${measured(cohort.coverageRuns)}</td><td>${cohort.eligibleForMetrics === false ? `excluded: ${escape(cohort.exclusionReason)}` : 'eligible'}</td></tr>`).join('');
  const cohortTable = cohorts ? `<section><h2>Evidence cohorts</h2><div class="scroll"><table><thead><tr><th scope="col">Cohort ID</th><th scope="col">Configuration</th><th scope="col">Task</th><th scope="col">Runs</th><th scope="col">Metric status</th></tr></thead><tbody>${cohorts}</tbody></table></div></section>` : '';
  return page('Architecture', `<p>Architecture version: ${escape(report.architectureVersion)} · Execution configuration: ${escape(configuration)} · Task: ${escape(task)}</p><p>${report.coverageRuns} eligible runs across ${measured(report.cohorts?.length)} observed cohorts. ${report.insufficientEvidence ? 'Insufficient evidence; no absence verdict is supported.' : 'Findings remain hypotheses.'}</p><p>Inventory: ${report.inventory.agents} agents · ${report.inventory.skills} skills · ${report.inventory.references} references · ${report.inventory.scripts} scripts</p>${cohortTable}<label>Search hypotheses <input id="search" type="search"></label>${cards || '<section><h2>No hypotheses</h2><p>No eligible findings are available. Not observed does not mean unused.</p></section>'}`);
}

function renderComponentEvidence(evidence = {}) {
  const rows = Object.entries(evidence).map(([name, row]) => `<tr><th scope="row">${escape(name)}</th><td>${row?.supported === true ? 'yes' : row?.supported === false ? 'no' : 'unknown'}</td>${['attempted', 'observed', 'completed', 'failed', 'pending', 'expected', 'missing'].map(key => `<td>${measured(row?.[key])}</td>`).join('')}</tr>`).join('');
  return rows ? `<details><summary>Component receipt counts</summary><p>Counts describe captured receipts only. Expected and missing stay unknown without independent evidence. Skill counts are distinct activations; script and model counts are distinct spans. Support and expectations describe only a supplied stimulus manifest; they never establish exhaustive capture.</p><div class="scroll"><table><thead><tr>${['Component', 'Supported', 'Attempted', 'Observed', 'Completed', 'Failed', 'Pending', 'Expected', 'Missing'].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></details>` : '';
}

function renderRuns(runs) {
  const cards = runs.map(run => {
    const rows = [...run.events].sort((a,b)=>(a.Sequence??0)-(b.Sequence??0)).map(row => `<tr${row.EventId ? ` id="${eventAnchor(row.EventId)}"` : ''}><td>${escape(row.Sequence)}</td><td>${escape(row.TimeGenerated)}</td><td><code>${escape(row.EventId)}</code></td><td>${escape(row.Source || row.Surface)}</td><td>${escape(row.EventName)}</td><td>${escape(row.AgentName)}</td><td>${escape(row.ToolName || row.ReferenceName || row.ScriptName || row.SkillName)}</td><td>${escape(row.Status)}</td><td>${escape(row.ConfigurationVersion || run.configurationVersion)}</td><td>${escape(row.ModelRequested)}</td><td>${escape(row.ModelActual)}</td><td>${escape(row.Provider)}</td><td>${measured(row.InputTokens)} / ${measured(row.OutputTokens)}</td></tr>`).join('');
    return `<article data-card id="${runAnchor(run.runId)}"><h2>${escape(run.runId)}</h2><p>Evidence tier: ${escape(run.evidenceTier)}</p><p>Architecture: ${escape(run.architectureVersion)} · Configuration: ${escape(run.configurationVersion)} · Task: ${escape(run.taskId)} · Collector: ${escape(run.lifecycle?.collector)} · Process: ${escape(run.lifecycle?.process)} · Capture: ${run.evidenceComplete ? 'complete' : 'partial or unknown'}</p><p>Coverage: ${['agents','skills','references','scripts','tools','models'].map(kind => `${kind}: ${escape(run.coverage?.[kind] || 'unknown')}`).join(' · ')}</p>${renderComponentEvidence(run.coverageEvidence)}${run.nativeEvents ? `<p><a href="${runAnchor(run.runId)}.html">Open session replay</a></p>` : ''}<details><summary>Ordered event evidence (${run.events.length} rows)</summary><div class="scroll"><table><caption>Recorded metadata in sequence order; token values are per event, not a deduplicated total.</caption><thead><tr>${['Sequence','Timestamp','Evidence ID','Source','Event','Actor','Component','Status','Configuration','Requested model','Actual model','Provider','Input / output tokens'].map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></details></article>`;
  }).join('');
  return page('Runs', `<label>Search runs <input id="search" type="search"></label>${cards || '<section><h2>No recorded runs</h2><p>Capture a run to inspect its evidence.</p></section>'}`);
}

function loadExperiments(directory) {
  if (!directory) return { records: [], invalid: 0 };
  const records = [];
  let invalid = 0;
  for (const status of ['accepted', 'rejected', 'inconclusive']) {
    const dir = path.join(directory, status);
    if (!fs.existsSync(dir)) continue;
    let entries;
    try {
      const stat = fs.lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('invalid outcome directory');
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { invalid++; continue; }
    if (entries.length > 100) invalid += entries.length - 100;
    for (const entry of entries.slice(0, 100)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const file = path.join(dir, entry.name);
        if (fs.statSync(file).size > 1024 * 1024) throw new Error('oversized record');
        const row = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (typeof row.id !== 'string' || !row.id.trim() || row.status !== status || !row.baseline || typeof row.baseline !== 'object' || Array.isArray(row.baseline) || !row.candidate || typeof row.candidate !== 'object' || Array.isArray(row.candidate)) throw new Error('invalid record');
        records.push(row);
      } catch { invalid++; }
    }
  }
  return { records, invalid };
}

function renderCompare({ records, invalid, availableRunIds }) {
  const cards = records.map(record => {
    const known = value => typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'unknown';
    const architectureCompatible = known(record.baseline.architectureVersion) && record.baseline.architectureVersion === record.candidate.architectureVersion;
    const configurationCompatible = known(record.baseline.configurationVersion) && record.baseline.configurationVersion === record.candidate.configurationVersion;
    const compatible = architectureCompatible && configurationCompatible;
    const metrics = side => `<td>Architecture: ${escape(side.architectureVersion)}<br>Configuration: ${escape(side.configurationVersion)}<br>Correctness: ${measured(side.passed)} / ${measured(side.trials)}<br>Duration (ms): ${measured(side.durationMs)}<br>Input / output tokens: ${measured(side.inputTokens)} / ${measured(side.outputTokens)}<br>Usage coverage: ${measured(side.usageCoverage)}<br>${(Array.isArray(side.runIds) ? side.runIds : []).map(id => link(id, availableRunIds)).join(' · ')}</td>`;
    return `<article data-card data-status="${escape(record.status)}"><h2>${escape(record.id)}</h2><span class="tag">${escape(record.status)}</span><p>Version compatibility: ${compatible ? 'compatible: matching known architecture and configuration versions' : 'unknown or mismatched architecture/configuration; no efficiency conclusion'}</p><p>Evidence tier: ${escape(record.evidenceTier)} · Candidate: ${escape(record.change)}</p><div class="scroll"><table><thead><tr><th scope="col">Baseline</th><th scope="col">Candidate</th></tr></thead><tbody><tr>${metrics(record.baseline)}${metrics(record.candidate)}</tr></tbody></table></div><p>Decision evidence: ${escape(record.reason)}</p></article>`;
  }).join('');
  return page('Compare', `<label>Search experiments <input id="search" type="search"></label><label>Outcome <select id="status"><option value="all">All</option><option>accepted</option><option>rejected</option><option>inconclusive</option></select></label><p>${invalid} invalid records excluded. Stored decisions are shown as recorded; this page never approves or merges a change.</p>${cards || '<section><h2>No experiment results yet</h2><p>Validated manifests are not execution results. Record protected trials before comparing candidates.</p></section>'}`);
}

function writeViews(report, runs, experiments, outDir, options = {}) {
  const availableRunIds = new Set(runs.map(run => run.runId));
  const availableEventIds = new Set(runs.flatMap(run => run.events || []).map(event => event.EventId).filter(Boolean));
  const pages = {
    'runs.html': renderRuns(runs),
    'architecture.html': renderArchitecture(report, { availableRunIds, availableEventIds }),
    'compare.html': renderCompare({ ...experiments, availableRunIds })
  };
  for (const run of runs) if (run.nativeEvents) {
    pages[`${runAnchor(run.runId)}.html`] = renderSessionWaterfall(run.nativeEvents, run.sessionId, { metadataOnly: true, nativeSpans: run.nativeSpans || [], productNavigation: true, repoRoot: options.repoRoot, deliveryStatus: run.deliveryStatus });
  }
  for (const [name, html] of Object.entries(pages)) fs.writeFileSync(path.join(outDir, name), html, { flag: 'wx', mode: 0o600 });
  return Object.keys(pages).map(name => path.join(outDir, name));
}
module.exports = { renderArchitecture, renderRuns, renderCompare, loadExperiments, writeViews };
