/* AgentOps Local UI client. Vanilla JS, no dependencies. All data is inserted with
   textContent / attributes only; nothing from the API is ever parsed as HTML. */
(() => {
  'use strict';

  const main = document.getElementById('main');
  const announcer = document.getElementById('announcer');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const KIND_LABEL = { session: 'Session', turn: 'Turn', chat: 'Model call', tool: 'Tool call', hook: 'Hook', agent: 'Subagent', compaction: 'Compaction' };
  const STATUS_LABEL = { ok: 'Completed', failed: 'Failed', live: 'Live', incomplete: 'Incomplete' };
  const state = { runs: null, detail: null, selected: null, pinned: null, collapsed: new Set(), routeKey: '' };

  // ---------- helpers ----------
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'style') Object.assign(el.style, value);
        else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else if (key === 'dataset') Object.assign(el.dataset, value);
        else el.setAttribute(key, value === true ? '' : String(value));
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function svg(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
    for (const child of children) el.append(child);
    return el;
  }

  function icon(name, size = 16) {
    const paths = {
      alert: 'M8.9 1.6a1 1 0 0 0-1.8 0L.6 13.5A1 1 0 0 0 1.5 15h13a1 1 0 0 0 .9-1.5L8.9 1.6ZM8 5.5c.4 0 .75.34.75.75v3.5a.75.75 0 0 1-1.5 0v-3.5c0-.41.34-.75.75-.75Zm0 7.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
      info: 'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm1.25 8h-2.5v-1.5h.5V8h-.5V6.5h2V10.5h.5V12Z',
      search: 'M7 1.5a5.5 5.5 0 0 1 4.38 8.82l3.15 3.15-1.06 1.06-3.15-3.15A5.5 5.5 0 1 1 7 1.5Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
      back: 'M9.78 3.22a.75.75 0 0 1 0 1.06L6.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z',
      caret: 'M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z',
      refresh: 'M8 2.5a5.5 5.5 0 0 0-5.22 3.76.75.75 0 1 1-1.42-.48A7 7 0 0 1 13.5 4.1V2.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h1.6A5.49 5.49 0 0 0 8 2.5Zm-6.25 6.5h3.5a.75.75 0 0 1 0 1.5h-1.6a5.5 5.5 0 0 0 9.57-.76.75.75 0 1 1 1.42.48A7 7 0 0 1 2.5 11.9v1.35a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 1.75 9Z'
    };
    return svg('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': 'true' }, svg('path', { fill: 'currentColor', d: paths[name] }));
  }

  const nf = new Intl.NumberFormat();
  function fmtInt(value) { return value === null || value === undefined ? '—' : nf.format(value); }
  function fmtTokens(value) {
    if (value === null || value === undefined) return '—';
    if (value < 1000) return String(value);
    if (value < 1e6) return `${(value / 1e3).toFixed(value < 1e4 ? 1 : 0)}k`;
    if (value < 1e9) return `${(value / 1e6).toFixed(value < 1e7 ? 2 : 1)}M`;
    return `${(value / 1e9).toFixed(2)}B`;
  }
  function fmtDuration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const s = ms / 1000;
    if (s < 10) return `${s.toFixed(1)} s`;
    if (s < 60) return `${Math.round(s)} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} m ${String(Math.round(s % 60)).padStart(2, '0')} s`;
    const hrs = Math.floor(m / 60);
    return `${hrs} h ${String(m % 60).padStart(2, '0')} m`;
  }
  function fmtCost(value) {
    if (value === null || value === undefined) return 'n/a';
    if (value === 0) return '$0.00';
    if (value < 0.01) return '<$0.01';
    if (value < 100) return `$${value.toFixed(2)}`;
    return `$${nf.format(Math.round(value))}`;
  }
  const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const tf = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const df = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  function fmtWhen(iso) {
    if (!iso) return { text: '—', title: '' };
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    const title = dtf.format(date);
    if (diff < 60e3) return { text: 'Just now', title };
    if (diff < 3600e3) return { text: `${Math.round(diff / 60e3)} min ago`, title };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (date >= today) return { text: `Today ${tf.format(date)}`, title };
    if (date >= new Date(today.getTime() - 864e5)) return { text: `Yesterday ${tf.format(date)}`, title };
    return { text: `${df.format(date)}, ${tf.format(date)}`, title };
  }
  function plural(n, word, many) { return `${fmtInt(n)} ${n === 1 ? word : (many || `${word}s`)}`; }
  function announce(text) { announcer.textContent = ''; setTimeout(() => { announcer.textContent = text; }, 30); }

  async function api(path) {
    const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
    return body;
  }

  function pill(status) { return h('span', { class: `pill ${status}`, text: STATUS_LABEL[status] || status }); }
  function cmd(text) { return h('div', { class: 'cmd' }, h('code', { translate: 'no', text })); }

  // ---------- theme ----------
  const THEMES = ['system', 'light', 'dark'];
  function applyTheme(theme) {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    const button = document.getElementById('theme-toggle');
    button.setAttribute('aria-label', `Theme: ${theme}`);
    button.title = `Theme: ${theme} (press t)`;
  }
  function cycleTheme() {
    let current = 'system';
    try { current = localStorage.getItem('agentops-theme') || 'system'; } catch { /* storage blocked */ }
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    try { localStorage.setItem('agentops-theme', next); } catch { /* storage blocked */ }
    applyTheme(next);
    announce(`Theme ${next}`);
  }
  try { applyTheme(localStorage.getItem('agentops-theme') || 'system'); } catch { applyTheme('system'); }
  document.getElementById('theme-toggle').addEventListener('click', cycleTheme);

  // ---------- routing ----------
  function parseRoute() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [pathPart, query = ''] = hash.split('?');
    const params = new URLSearchParams(query);
    const runMatch = /^\/run\/([^/]+)$/.exec(pathPart);
    if (runMatch) return { name: 'run', id: decodeURIComponent(runMatch[1]), params };
    return { name: 'home', params };
  }
  function homeHash(params) {
    const query = new URLSearchParams();
    for (const key of ['q', 'model', 'repo', 'status']) if (params[key]) query.set(key, params[key]);
    const text = query.toString();
    return text ? `#/?${text}` : '#/';
  }

  async function route() {
    const current = parseRoute();
    if (current.name === 'run') {
      if (state.routeKey !== `run:${current.id}`) {
        state.routeKey = `run:${current.id}`;
        await renderRun(current.id);
      }
    } else {
      const key = `home:${current.params.toString()}`;
      const wasHome = state.routeKey.startsWith('home:');
      state.routeKey = key;
      state.lastHomeHash = location.hash || '#/';
      await renderHome(current.params, wasHome);
    }
  }

  // ---------- home ----------
  let searchTimer = null;
  async function renderHome(params, keepFocus) {
    const filters = { q: params.get('q') || '', model: params.get('model') || '', repo: params.get('repo') || '', status: params.get('status') || '' };
    if (!state.runs) main.replaceChildren(h('p', { class: 'loading', role: 'status', text: 'Reading local Copilot CLI sessions…' }));
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    let data;
    try {
      data = await api(`/api/runs${query ? `?${query}` : ''}`);
    } catch (error) {
      main.replaceChildren(errorState('Could not read local runs', error));
      return;
    }
    state.runs = data;
    document.title = 'AgentOps · Runs';
    updatePrivacy(data.allowContent);

    const active = document.activeElement;
    const focusId = keepFocus && active && active.id ? active.id : null;
    const caret = focusId === 'search' ? active.selectionStart : null;

    const anyFilter = Object.values(filters).some(Boolean);
    const view = h('div', { class: 'home' },
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', { text: 'Copilot CLI runs' }),
          h('p', { text: data.totalSessions
            ? `${plural(data.totalSessions, 'session')} on this machine · newest ${fmtInt(data.scanned)} analysed`
            : 'Sessions on this machine appear here automatically.' })),
        h('div', { class: 'head-actions' },
          h('button', { type: 'button', class: 'button quiet', onclick: () => { state.routeKey = ''; route(); }, title: 'Refresh (r)' }, icon('refresh', 14), 'Refresh'))),
      data.totalSessions ? kpiStrip(data.kpis) : null,
      data.totalSessions ? filterBar(data, filters) : null,
      data.totalSessions ? runsTable(data, anyFilter) : firstRunEmpty(),
      footnote(data.pricing, true));
    main.replaceChildren(view);
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus(); if (caret !== null && el.setSelectionRange) el.setSelectionRange(caret, caret); }
    }
    announce(`${plural(data.runs.length, 'run')} shown`);
  }

  function kpiStrip(k) {
    const tile = (label, value, sub, opts = {}) => h('div', { class: 'kpi' },
      h('div', { class: 'kpi-label' }, label, opts.est ? h('span', { class: 'est', title: 'Estimate from public list prices', text: 'EST.' }) : null),
      h('div', { class: `kpi-value${opts.bad ? ' bad' : ''}`, text: value, title: opts.title || null }),
      h('div', { class: 'kpi-sub', text: sub }));
    const tokenTotal = k.tokens.input + k.tokens.output;
    return h('section', { class: 'kpis', 'aria-label': 'Summary for the runs shown' },
      tile('Runs', fmtInt(k.runs), `${fmtInt(k.toolCalls)} tool calls`),
      tile('Failures', fmtInt(k.failures), k.failedRuns ? `in ${plural(k.failedRuns, 'run')}` : 'No failed runs', { bad: k.failures > 0 }),
      tile('p95 tool latency', fmtDuration(k.p95ToolMs), 'across all tool calls'),
      tile('Tokens', fmtTokens(tokenTotal), `${fmtTokens(k.tokens.input)} in · ${fmtTokens(k.tokens.output)} out`, { title: `${fmtInt(tokenTotal)} tokens in ${plural(k.tokens.runsWithTokens, 'run')} with usage data` }),
      tile('Cost', fmtCost(k.costUsd), unpricedNote(k.unpricedModels) || (k.premiumRequests ? `${fmtInt(Math.round(k.premiumRequests * 100) / 100)} premium requests` : 'list-price estimate'), { est: true, title: k.costLabel || null }));
  }

  function unpricedNote(models) {
    return models && models.length ? `${plural(models.length, 'model')} unpriced` : '';
  }

  function costCell(run) {
    if (!run.tokens.known) return h('span', { class: 'zero', text: '—', title: 'No usage recorded yet' });
    const partial = run.unpricedModels && run.unpricedModels.length;
    if (!partial) return fmtCost(run.costUsd);
    return h('span', { title: `${run.costLabel}: no published price for ${run.unpricedModels.join(', ')}` },
      fmtCost(run.costUsd), run.costUsd === null ? null : h('span', { class: 'model-more', text: '+n/a' }));
  }

  function filterBar(data, filters) {
    const setFilter = (key, value) => {
      const next = { ...filters, [key]: value };
      history.replaceState(null, '', homeHash(next));
      route();
    };
    const select = (key, label, options, render) => h('label', { class: 'select' },
      h('span', { class: 'sr-only', text: label }),
      h('select', { id: `filter-${key}`, class: filters[key] ? 'active' : null, onchange: event => setFilter(key, event.target.value) },
        h('option', { value: '', text: `All ${label.toLowerCase()}` }),
        options.map(option => h('option', { value: option.value, selected: option.value === filters[key], text: `${render ? render(option.value) : option.value} (${option.count})` }))));
    const search = h('input', {
      id: 'search', type: 'search', placeholder: 'Search runs, tools, models…', value: filters.q, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search runs',
      oninput: event => { clearTimeout(searchTimer); const value = event.target.value; searchTimer = setTimeout(() => setFilter('q', value.trim()), 160); },
      onkeydown: event => { if (event.key === 'ArrowDown') { event.preventDefault(); focusRunRow(0); } if (event.key === 'Escape' && event.target.value) { event.target.value = ''; setFilter('q', ''); } }
    });
    const anyFilter = Object.values(filters).some(Boolean);
    return h('div', { class: 'filters', role: 'search' },
      h('div', { class: 'search' }, icon('search', 14), search, filters.q ? null : h('kbd', { text: '/', 'aria-hidden': 'true' })),
      select('model', 'Models', data.facets.models),
      select('repo', 'Repos', data.facets.repos),
      select('status', 'Statuses', data.facets.statuses, value => STATUS_LABEL[value] || value),
      anyFilter ? h('button', { type: 'button', class: 'button quiet', onclick: () => { history.replaceState(null, '', '#/'); route(); }, text: 'Clear filters' }) : null,
      h('span', { class: 'result-count', role: 'status', text: `${plural(data.runs.length, 'run')}${anyFilter ? ` of ${fmtInt(data.scanned)}` : ''}` }));
  }

  function runsTable(data, anyFilter) {
    if (!data.runs.length) {
      return h('div', { class: 'card' }, h('div', { class: 'empty' },
        h('h2', { text: 'No runs match these filters' }),
        h('p', { text: 'Try a different search term, or clear the filters to see every analysed run.' }),
        h('button', { type: 'button', class: 'button', onclick: () => { history.replaceState(null, '', '#/'); route(); }, text: 'Clear filters' })));
    }
    const rows = data.runs.map((run, index) => {
      const when = fmtWhen(run.startedAt);
      const href = `#/run/${encodeURIComponent(run.id)}`;
      const otherModels = run.models.filter(model => model !== run.model).length;
      return h('tr', { onclick: event => { if (event.target.closest('a')) return; location.hash = href; } },
        h('td', null, pill(run.status)),
        h('td', null, h('a', { class: 'run-link', href, 'data-row': index, title: when.title, onkeydown: rowKeys }, when.text),
          h('span', { class: 'cell-sub mono', text: run.id.slice(0, 8) })),
        h('td', null, run.repo.name ? h('span', { class: 'repo-name', text: run.repo.name }) : h('span', { class: 'hash', text: run.repo.hash ? `#${run.repo.hash.slice(0, 8)}` : '—', title: 'Repository hash (name not recorded)' })),
        h('td', null, h('span', { class: 'model', translate: 'no', text: run.model || '—' }), otherModels ? h('span', { class: 'model-more', text: `+${otherModels}`, title: run.models.join(', ') }) : null),
        h('td', { class: 'num' }, fmtDuration(run.durationMs)),
        h('td', { class: 'num tokens-io col-optional' }, run.tokens.known
          ? [fmtTokens(run.tokens.input), h('span', { class: 'sep', text: '/' }), fmtTokens(run.tokens.output)]
          : h('span', { class: 'zero', text: '—', title: 'No usage recorded yet (session still open or ended abruptly)' })),
        h('td', { class: 'num col-optional' }, run.toolCalls ? fmtInt(run.toolCalls) : h('span', { class: 'zero', text: '0' })),
        h('td', { class: 'num' }, run.failures ? h('span', { class: 'fail-count', text: fmtInt(run.failures), title: run.failureGroups.map(g => `${g.count}× ${g.name} ${g.outcome}`).join(', ') }) : h('span', { class: 'zero', text: '0' })),
        h('td', { class: 'num col-optional' }, costCell(run)));
    });
    return h('div', { class: 'card' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'runs' },
          h('caption', { class: 'sr-only', text: 'Copilot CLI runs, newest first' }),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Status' }),
            h('th', { scope: 'col', text: 'When' }),
            h('th', { scope: 'col', text: 'Repo' }),
            h('th', { scope: 'col', text: 'Model' }),
            h('th', { scope: 'col', class: 'num', text: 'Duration' }),
            h('th', { scope: 'col', class: 'num col-optional', text: 'Tokens in / out' }),
            h('th', { scope: 'col', class: 'num col-optional', text: 'Tools' }),
            h('th', { scope: 'col', class: 'num', text: 'Failures' }),
            h('th', { scope: 'col', class: 'num col-optional' }, 'Cost ', h('span', { class: 'est', text: 'EST.' })))),
          h('tbody', null, rows))),
      h('div', { class: 'table-foot' },
        h('span', { text: data.totalSessions > data.scanned
          ? `Showing the newest ${fmtInt(data.scanned)} of ${plural(data.totalSessions, 'session')}. Start with --limit <n> to analyse more.`
          : `All ${plural(data.totalSessions, 'session')} analysed.` }),
        h('span', { class: 'cost-total', text: `Cost total: ${data.kpis.costLabel || fmtCost(data.kpis.costUsd)}` }),
        h('span', { text: anyFilter ? 'KPIs reflect the filtered runs.' : 'Newest first.' })));
  }

  function rowKeys(event) {
    const index = Number(event.currentTarget.dataset.row);
    if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); focusRunRow(index + 1); }
    if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); if (index === 0) document.getElementById('search')?.focus(); else focusRunRow(index - 1); }
  }
  function focusRunRow(index) {
    const link = main.querySelector(`a[data-row="${index}"]`);
    if (link) link.focus();
  }

  function firstRunEmpty() {
    return h('div', { class: 'card' }, h('div', { class: 'empty' },
      h('h2', { text: 'No Copilot CLI sessions found yet' }),
      h('p', null, 'AgentOps reads the session logs that GitHub Copilot CLI writes to ', h('code', { class: 'nowrap', text: '~/.copilot/session-state' }), '. Nothing is uploaded.'),
      h('ol', { class: 'steps' },
        h('li', null, h('div', null, 'Run any Copilot CLI session in a repo:', cmd('copilot'))),
        h('li', null, h('div', null, 'Or run it through AgentOps for per-call tokens and a full span trace:', cmd('agentops copilot-session launch --repo . -- -p "summarise this repo"'))),
        h('li', null, h('div', null, 'Come back here and press Refresh, or reopen:', cmd('agentops ui'))))));
  }

  function footnote(pricing, home) {
    const sources = pricing && pricing.sources ? pricing.sources : [];
    return h('footer', { class: 'footnote' },
      h('p', null,
        'Cost is an estimate from public per-token list prices (table dated ', pricing ? pricing.date : '—', '; ',
        sources.map((source, index) => [index ? ', ' : '', h('a', { href: source, target: '_blank', rel: 'noreferrer noopener', text: sourceName(source) })]),
        '). Copilot bills premium requests, not tokens. Models without a published price show n/a and are counted as unpriced, never as $0.'),
      h('span', { class: 'shortcuts' }, home
        ? [h('kbd', { text: '/' }), 'search', h('kbd', { text: '↑↓' }), 'move', h('kbd', { text: 'Enter' }), 'open', h('kbd', { text: 't' }), 'theme']
        : [h('kbd', { text: '↑↓' }), 'spans', h('kbd', { text: '←→' }), 'fold', h('kbd', { text: 'Esc' }), 'back', h('kbd', { text: 't' }), 'theme']));
  }

  function sourceName(url) {
    if (/anthropic|claude/.test(url)) return 'Anthropic';
    if (/openai/.test(url)) return 'OpenAI';
    try { return new URL(url).hostname; } catch { return 'source'; }
  }

  function errorState(title, error) {
    return h('div', { class: 'card error-state' }, h('div', { class: 'empty' },
      h('h2', { text: title }),
      h('p', { text: error.status === 404 ? 'This run is not in the local session store any more.' : `The local server returned: ${error.message}` }),
      h('a', { class: 'button', href: '#/' }, icon('back', 14), 'All runs')));
  }

  function updatePrivacy(allowContent) {
    const chip = document.getElementById('privacy-chip');
    document.getElementById('privacy-label').textContent = allowContent ? 'Content visible (local)' : 'Metadata only';
    chip.classList.toggle('content', Boolean(allowContent));
    chip.title = allowContent
      ? 'Started with --allow-content: prompts, tool arguments and results can be shown for local sessions (secrets redacted).'
      : 'Only metadata (names, timings, counts) is served. Prompts, arguments and results never leave the session files.';
  }

  // ---------- run detail ----------
  async function renderRun(id) {
    main.replaceChildren(h('p', { class: 'loading', role: 'status', text: 'Building the trace…' }));
    let detail;
    try {
      detail = await api(`/api/runs/${encodeURIComponent(id)}`);
    } catch (error) {
      main.replaceChildren(errorState(error.status === 404 ? 'Run not found' : 'Could not load this run', error));
      return;
    }
    state.detail = detail;
    state.content = null;
    state.selected = null;
    state.pinned = null;
    state.collapsed = new Set();
    if (detail.spans.length > 400) for (const span of detail.spans) if (span.kind === 'turn' && span.childCount) state.collapsed.add(span.id);
    updatePrivacy(detail.allowContent);
    const run = detail.run;
    document.title = `AgentOps · ${run.repo.name || 'Run'} · ${run.id.slice(0, 8)}`;
    const when = fmtWhen(run.startedAt);

    const failures = detail.failures.length ? h('div', { class: 'callout danger', role: 'alert' }, icon('alert'),
      h('div', null,
        h('strong', { text: run.failures === 1 ? '1 failure in this run' : `${fmtInt(run.failures)} failures in this run` }),
        h('ul', null, detail.failures.map(failure => h('li', null, failureText(failure)))))) : null;
    const warnings = detail.warnings.length ? h('div', { class: 'callout warn' }, icon('info'), h('div', null, detail.warnings.map(text => h('p', { text })))) : null;

    const traceSection = h('section', { 'aria-labelledby': 'trace-title' },
      h('div', { class: 'section-head' },
        h('h2', { id: 'trace-title', text: 'Trace' }),
        legend(detail.spans)),
      h('div', { class: 'trace-layout' },
        h('div', { class: 'card trace' }, traceToolbar(detail), axisRow(detail), meterRow(detail), h('div', { class: 'rows', id: 'rows' })),
        h('aside', { class: 'card inspector', id: 'inspector', 'aria-live': 'polite', 'aria-label': 'Span details' })));

    const view = h('div', { class: 'detail' },
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: backHref(), id: 'back-link' }, icon('back', 14), 'All runs')),
      h('div', { class: 'page-head' },
        h('div', null,
          h('div', { class: 'detail-title' }, h('h1', { text: run.repo.name || (run.repo.hash ? `Repo #${run.repo.hash.slice(0, 8)}` : 'Copilot CLI run') }), pill(run.status)),
          h('div', { class: 'meta-line' },
            h('span', { title: when.title, text: when.title || when.text }),
            h('span', null, h('span', { class: 'mono', translate: 'no', text: run.model || '—' }), run.models.length > 1 ? ` +${run.models.length - 1}` : ''),
            run.copilotVersion ? h('span', { text: `Copilot CLI ${run.copilotVersion}` }) : null,
            h('span', null, h('span', { class: 'mono', translate: 'no', text: run.id }),
              h('button', { type: 'button', class: 'copy', 'aria-label': 'Copy session ID', onclick: event => copyText(run.id, event.currentTarget) }, 'Copy')),
            h('span', { text: run.source === 'copilot+ledger' ? 'Session log + AgentOps ledger' : run.source === 'ledger' ? 'AgentOps ledger' : 'Session log' })))),
      failures,
      warnings,
      runKpis(run),
      traceSection,
      h('div', { class: 'split' }, toolTable(detail), usageTable(detail)),
      footnote(detail.pricing, false));
    main.replaceChildren(view);
    renderRows();
    renderInspector(null);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    announce(`Run ${run.id.slice(0, 8)}: ${STATUS_LABEL[run.status] || run.status}, ${plural(run.toolCalls, 'tool call')}, ${plural(run.failures, 'failure')}`);
  }

  function backHref() {
    return state.lastHomeHash || '#/';
  }

  function failureText(failure) {
    const noun = failure.kind === 'tool' ? 'tool call' : (KIND_LABEL[failure.kind] || failure.kind).toLowerCase();
    return [`${failure.count} ${failure.count === 1 ? noun : `${noun}s`} ${failure.outcome === 'failed' ? 'failed' : failure.outcome}: `, h('span', { class: 'mono', translate: 'no', text: failure.name })];
  }

  function copyText(text, button) {
    const done = () => { button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
  }

  function runKpis(run) {
    const tile = (label, value, sub, opts = {}) => h('div', { class: 'kpi' },
      h('div', { class: 'kpi-label' }, label, opts.est ? h('span', { class: 'est', text: 'EST.' }) : null),
      h('div', { class: `kpi-value${opts.bad ? ' bad' : ''}`, text: value }),
      h('div', { class: 'kpi-sub', text: sub }));
    return h('section', { class: 'kpis', 'aria-label': 'Run summary' },
      tile('Active time', fmtDuration(run.durationMs), `${plural(run.turns, 'turn')}${run.subagents ? ` · ${plural(run.subagents, 'subagent')}` : ''}`),
      tile('Tool calls', fmtInt(run.toolCalls), run.p95ToolMs !== null ? `p95 ${fmtDuration(run.p95ToolMs)}` : 'no tool calls'),
      tile('Failures', fmtInt(run.failures), run.failures ? `${plural(run.toolFailures, 'tool call')} failed` : 'Nothing failed', { bad: run.failures > 0 }),
      tile('Tokens', run.tokens.known ? fmtTokens(run.tokens.input + run.tokens.output) : '—', run.tokens.known ? `${fmtTokens(run.tokens.input)} in · ${fmtTokens(run.tokens.output)} out` : 'not recorded yet'),
      tile('Cost', fmtCost(run.costUsd), unpricedNote(run.unpricedModels) || (run.premiumRequests !== null ? `${fmtInt(run.premiumRequests)} premium requests` : 'list-price estimate'), { est: true, title: run.costLabel || null }));
  }

  function legend(spans) {
    const kinds = [...new Set(spans.map(span => span.kind))];
    const items = kinds.map(kind => h('span', null, h('i', { class: `swatch k-${kind}` }), KIND_LABEL[kind] || kind));
    if (spans.some(span => span.status === 'failed')) items.push(h('span', null, h('i', { class: 'swatch k-failed' }), 'Failed'));
    return h('div', { class: 'legend', 'aria-label': 'Legend' }, items);
  }

  function traceToolbar(detail) {
    const hasCollapsible = detail.spans.some(span => span.childCount && span.depth > 0);
    return h('div', { class: 'trace-toolbar' },
      h('span', { class: 'muted', text: `${plural(detail.spans.length, 'span')} · ${fmtDuration(detail.spans[0]?.durationMs)} wall clock` }),
      hasCollapsible ? h('div', { class: 'head-actions' },
        h('button', { type: 'button', class: 'button quiet', onclick: () => { state.collapsed.clear(); renderRows(); }, text: 'Expand all' }),
        h('button', { type: 'button', class: 'button quiet', onclick: () => { for (const span of detail.spans) if (span.childCount && span.depth > 0) state.collapsed.add(span.id); renderRows(); }, text: 'Collapse all' })) : null);
  }

  function niceStep(total, target) {
    const raw = total / target;
    const units = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600].map(s => s * 1000);
    const sub = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    for (const unit of [...sub, ...units]) if (unit >= raw) return unit;
    return units[units.length - 1];
  }
  function ticks(total) {
    if (!total) return [0];
    const step = niceStep(total, 6);
    const result = [];
    for (let t = 0; t <= total + 1; t += step) result.push(t);
    return result;
  }
  function tickLabel(ms, step) {
    if (ms === 0) return '0';
    if (step < 1000) return `${ms} ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)} s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m${ms % 60000 ? ` ${Math.round((ms % 60000) / 1000)}s` : ''}`;
    return `${Math.floor(ms / 3600000)}h${ms % 3600000 ? ` ${Math.round((ms % 3600000) / 60000)}m` : ''}`;
  }

  function totalMs() { return Math.max(1, state.detail.spans[0]?.durationMs || 1); }
  function pct(ms) { return `${Math.min(100, Math.max(0, (ms / totalMs()) * 100))}%`; }

  function axisRow() {
    const list = ticks(totalMs());
    const step = list[1] || totalMs();
    return h('div', { class: 'axis', 'aria-hidden': 'true' },
      h('div', { class: 'axis-label', text: 'Span' }),
      h('div', { class: 'track' }, list.map(t => h('span', { class: 'tick', style: { left: pct(t) }, text: tickLabel(t, step) }))));
  }

  function meterRow(detail) {
    const series = detail.tokenSeries;
    const last = series.points[series.points.length - 1];
    const label = h('div', { class: 'meter-label' },
      h('span', { class: 'meter-title', text: series.granularity === 'call' ? 'Tokens · cost, cumulative' : 'Tokens · cost' }),
      h('span', { class: 'meter-value' }, last ? fmtTokens(last.input + last.output) : '—', ' ', h('small', { text: last ? (last.costUsd === null ? '· cost n/a' : `· ${fmtCost(last.costUsd)} est.`) : '' })));
    const track = h('div', { class: 'track' });
    if (!series.points.length) {
      track.append(h('span', { class: 'meter-empty', text: 'No token usage recorded for this run yet.' }));
    } else {
      const max = Math.max(...series.points.map(point => point.input + point.output), 1);
      const coords = [[0, 100]];
      let prevY = 100;
      for (const point of series.points) {
        const x = Math.min(100, (point.tMs / totalMs()) * 100);
        const y = 100 - ((point.input + point.output) / max) * 100;
        coords.push([x, prevY], [x, y]);
        prevY = y;
      }
      coords.push([100, prevY]);
      const line = coords.map(([x, y]) => `${x},${y}`).join(' ');
      track.append(svg('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
        svg('polygon', { points: `${line} 100,100`, fill: 'var(--meter-fill)' }),
        svg('polyline', { points: line, fill: 'none', stroke: 'var(--meter)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' })));
      for (const point of series.points) {
        const y = 100 - ((point.input + point.output) / max) * 100;
        track.append(h('span', {
          class: 'meter-dot',
          style: { left: pct(point.tMs), top: `calc(8px + (100% - 16px) * ${y / 100})` },
          title: `${fmtDuration(point.tMs)}: ${fmtInt(point.input)} in · ${fmtInt(point.output)} out · ${point.costUsd === null ? 'cost n/a' : `${fmtCost(point.costUsd)} est.`}`
        }));
      }
      if (series.granularity === 'session') {
        track.append(h('span', { class: 'meter-empty', style: { right: '24px', left: 'auto' }, text: 'Session totals only. Run via agentops copilot-session launch for per-call tokens.' }));
      }
    }
    return h('div', { class: 'meter' }, label, track);
  }

  function visibleSpans() {
    const result = [];
    let hideDepth = Infinity;
    for (const span of state.detail.spans) {
      if (span.depth > hideDepth) continue;
      hideDepth = Infinity;
      result.push(span);
      if (state.collapsed.has(span.id)) hideDepth = span.depth;
    }
    return result;
  }

  function renderRows() {
    const container = document.getElementById('rows');
    if (!container) return;
    const spans = visibleSpans();
    const grid = h('div', { class: 'grid-lines', 'aria-hidden': 'true' }, ticks(totalMs()).slice(1).map(t => h('i', { style: { left: pct(t) } })));
    const tree = h('div', { role: 'tree', 'aria-label': 'Span tree. Use arrow keys to move, left and right to fold.', id: 'span-tree' });
    const focusTarget = state.selected || spans[0]?.id;
    for (const span of spans) tree.append(spanRow(span, span.id === focusTarget));
    tree.addEventListener('mouseleave', () => renderInspector(state.pinned ? findSpan(state.pinned) : null));
    container.replaceChildren(grid, tree);
  }

  function findSpan(id) { return state.detail.spans.find(span => span.id === id) || null; }

  function spanRow(span, tabbable) {
    const failed = span.status === 'failed';
    const expanded = !state.collapsed.has(span.id);
    const start = span.startMs;
    const endPct = ((start + span.durationMs) / totalMs()) * 100;
    const textOnLeft = endPct > 88;
    const row = h('div', {
      class: `span-row${failed ? ' failed' : ''}`,
      role: 'treeitem',
      tabindex: tabbable ? '0' : '-1',
      'aria-level': span.depth + 1,
      'aria-expanded': span.childCount ? String(expanded) : null,
      'aria-selected': state.pinned === span.id ? 'true' : 'false',
      'aria-label': `${KIND_LABEL[span.kind] || span.kind} ${span.name}, ${fmtDuration(span.durationMs)}${failed ? `, failed (${span.attrs.outcome || 'failed'})` : ''}`,
      dataset: { id: span.id, kind: span.kind },
      onclick: () => pin(span.id),
      onmouseenter: () => renderInspector(span),
      onfocus: () => { state.selected = span.id; renderInspector(span); },
      onkeydown: event => treeKeys(event, span)
    },
    h('div', { class: 'span-label', style: { paddingLeft: `${8 + span.depth * 14}px` } },
      span.childCount
        ? h('button', { type: 'button', class: 'caret', tabindex: '-1', 'aria-hidden': 'true', 'aria-expanded': String(expanded), onclick: event => { event.stopPropagation(); toggle(span.id); } }, icon('caret', 14))
        : h('span', { class: 'caret-spacer' }),
      h('i', { class: `swatch k-${failed ? 'failed' : span.kind}` }),
      h('span', { class: 'name', text: span.name, title: span.name }),
      span.childCount && !expanded ? h('span', { class: 'child-count', text: `+${span.childCount}` }) : null),
    h('div', { class: 'track' },
      h('span', { class: `bar k-${span.kind} ${span.kind}${failed ? ' failed' : ''}`, style: { left: pct(start), width: `max(2px, ${pct(span.durationMs)})` } }),
      h('span', { class: 'bar-text', style: textOnLeft ? { right: `calc(${100 - (start / totalMs()) * 100}% + 6px)` } : { left: `calc(${endPct}% + 6px)` }, text: failed ? `${fmtDuration(span.durationMs)} · ${span.attrs.outcome || 'failed'}` : fmtDuration(span.durationMs) })));
    return row;
  }

  function pin(id) {
    state.pinned = state.pinned === id ? null : id;
    state.selected = id;
    for (const row of document.querySelectorAll('.span-row')) {
      row.setAttribute('aria-selected', row.dataset.id === state.pinned ? 'true' : 'false');
      row.tabIndex = row.dataset.id === id ? 0 : -1;
    }
    renderInspector(state.pinned ? findSpan(state.pinned) : findSpan(id));
  }

  function toggle(id) {
    if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
    state.selected = id;
    renderRows();
    document.querySelector(`.span-row[data-id="${CSS.escape(id)}"]`)?.focus();
  }

  function treeKeys(event, span) {
    const rows = [...document.querySelectorAll('.span-row')];
    const index = rows.findIndex(row => row.dataset.id === span.id);
    const move = next => { if (next) { rows[index].tabIndex = -1; next.tabIndex = 0; next.focus(); next.scrollIntoView({ block: 'nearest' }); } };
    switch (event.key) {
      case 'ArrowDown': case 'j': event.preventDefault(); move(rows[index + 1]); break;
      case 'ArrowUp': case 'k': event.preventDefault(); move(rows[index - 1]); break;
      case 'Home': event.preventDefault(); move(rows[0]); break;
      case 'End': event.preventDefault(); move(rows[rows.length - 1]); break;
      case 'ArrowRight':
        event.preventDefault();
        if (span.childCount && state.collapsed.has(span.id)) toggle(span.id); else move(rows[index + 1]);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (span.childCount && !state.collapsed.has(span.id) && span.depth > 0) toggle(span.id);
        else if (span.parentId) move(rows.find(row => row.dataset.id === span.parentId));
        break;
      case 'Enter': case ' ': event.preventDefault(); pin(span.id); break;
      default: break;
    }
  }

  function renderInspector(span) {
    const panel = document.getElementById('inspector');
    if (!panel) return;
    if (!span) {
      const failed = state.detail.spans.find(item => item.status === 'failed');
      panel.replaceChildren(h('div', { class: 'inspector-empty' },
        h('h3', { text: 'Span details' }),
        h('p', { style: { marginTop: '10px' }, text: 'Hover or select a span to see its timing, status and token counts.' }),
        failed ? h('button', { type: 'button', class: 'button', onclick: () => { pin(failed.id); document.querySelector(`.span-row[data-id="${CSS.escape(failed.id)}"]`)?.scrollIntoView({ block: 'center' }); } }, 'Jump to first failure') : null,
        h('p', { class: 'hint', text: state.detail.allowContent ? 'Content mode is on: tool arguments and results can be loaded for tool spans.' : 'Metadata only. Prompts, tool arguments and results are never sent to this page.' })));
      return;
    }
    const a = span.attrs || {};
    const rows = [
      ['Status', span.status === 'failed' ? `Failed · ${a.outcome || 'failed'}` : (span.status === 'incomplete' ? 'Did not finish' : 'OK')],
      ['Starts at', `+${fmtDuration(span.startMs)}`],
      ['Duration', fmtDuration(span.durationMs)],
      a.model ? ['Model', a.model] : null,
      a.inputTokens !== undefined ? ['Input tokens', fmtInt(a.inputTokens)] : null,
      a.cacheReadTokens ? ['· cache read', fmtInt(a.cacheReadTokens)] : null,
      a.cacheWriteTokens ? ['· cache write', fmtInt(a.cacheWriteTokens)] : null,
      a.outputTokens !== undefined ? ['Output tokens', fmtInt(a.outputTokens)] : null,
      a.exitCode !== undefined ? ['Exit code', String(a.exitCode)] : null,
      a.mcpServer ? ['MCP server', a.mcpServer] : null,
      span.childCount ? ['Children', fmtInt(span.childCount)] : null,
      a.toolCallId ? ['Tool call ID', a.toolCallId.length > 22 ? `${a.toolCallId.slice(0, 20)}…` : a.toolCallId] : null,
      a.spanId ? ['Span ID', a.spanId] : null
    ].filter(Boolean);
    const content = state.detail.allowContent && span.kind === 'tool' && a.toolCallId ? contentBlock(a.toolCallId) : null;
    panel.replaceChildren(...[
      h('h3', null, h('i', { class: `swatch k-${span.status === 'failed' ? 'failed' : span.kind}` }), h('span', { text: span.name })),
      h('div', { class: 'kind', text: `${KIND_LABEL[span.kind] || span.kind}${state.pinned === span.id ? ' · pinned' : ''}` }),
      h('dl', null, rows.map(([term, value]) => [h('dt', { text: term }), h('dd', { text: value, class: term === 'Status' && span.status === 'failed' ? 'fail-count' : null })])),
      content,
      h('p', { class: 'hint', text: state.pinned === span.id ? 'Click the span again or press Enter to unpin.' : 'Click or press Enter to pin this span.' })].filter(Boolean));
  }

  function contentBlock(toolCallId) {
    const wrap = h('div', { class: 'content-block' });
    const show = () => {
      const entry = state.content && state.content.tools[toolCallId];
      wrap.replaceChildren(entry
        ? h('div', null,
          entry.arguments ? [h('h4', { text: 'Arguments (redacted)' }), h('pre', { text: entry.arguments })] : null,
          entry.error ? [h('h4', { text: 'Error' }), h('pre', { text: entry.error })] : null,
          entry.result ? [h('h4', { text: 'Result (redacted, truncated)' }), h('pre', { text: entry.result })] : null)
        : h('p', { class: 'muted', text: 'No content recorded for this call.' }));
    };
    if (state.content) show();
    else {
      wrap.append(h('button', { type: 'button', class: 'button', onclick: async () => {
        try { state.content = await api(`/api/runs/${encodeURIComponent(state.detail.run.id)}/content`); show(); } catch (error) { wrap.replaceChildren(h('p', { class: 'muted', text: `Content unavailable: ${error.message}` })); }
      } }, 'Show arguments and result'));
    }
    return wrap;
  }

  function toolTable(detail) {
    const stats = detail.toolStats;
    const maxTotal = Math.max(1, ...stats.map(stat => stat.totalMs));
    return h('section', { 'aria-labelledby': 'tools-title' },
      h('div', { class: 'section-head' }, h('h2', { id: 'tools-title', text: 'Tool latency' }), h('p', { text: 'Sorted by total time' })),
      h('div', { class: 'card' }, stats.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', text: 'Tool' }),
          h('th', { scope: 'col', class: 'num', text: 'Calls' }),
          h('th', { scope: 'col', class: 'num', text: 'p50' }),
          h('th', { scope: 'col', class: 'num', text: 'p95' }),
          h('th', { scope: 'col', class: 'num', text: 'Max' }),
          h('th', { scope: 'col', class: 'num', text: 'Total' }),
          h('th', { scope: 'col', class: 'num', text: 'Failures' }))),
        h('tbody', null, stats.map(stat => h('tr', { class: stat.failures ? 'has-fail' : null },
          h('td', null, h('span', { class: 'tool-name', text: stat.tool })),
          h('td', { class: 'num', text: fmtInt(stat.count) }),
          h('td', { class: 'num', text: fmtDuration(stat.p50Ms) }),
          h('td', { class: 'num', text: fmtDuration(stat.p95Ms) }),
          h('td', { class: 'num', text: fmtDuration(stat.maxMs) }),
          h('td', { class: 'num' }, h('span', { class: 'lat-cell' }, h('span', { class: 'lat-bar', style: { width: `${Math.max(2, (stat.totalMs / maxTotal) * 56)}px` } }), fmtDuration(stat.totalMs))),
          h('td', { class: 'num' }, stat.failures ? h('span', { class: 'fail-count', text: fmtInt(stat.failures) }) : h('span', { class: 'zero', text: '0' }))))))) :
        h('div', { class: 'empty' }, h('p', { text: 'This run made no tool calls.' }))));
  }

  function usageTable(detail) {
    const rows = detail.usageByModel;
    return h('section', { 'aria-labelledby': 'usage-title' },
      h('div', { class: 'section-head' }, h('h2', { id: 'usage-title', text: 'Tokens by model' }), h('p', { text: detail.run.source === 'ledger' ? 'From AgentOps ledger spans' : 'From the session shutdown totals' })),
      h('div', { class: 'card' }, rows.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null,
          h('th', { scope: 'col', text: 'Model' }),
          h('th', { scope: 'col', class: 'num', text: 'Input' }),
          h('th', { scope: 'col', class: 'num', title: 'Cache reads and writes, already included in Input', text: 'of which cached' }),
          h('th', { scope: 'col', class: 'num', text: 'Output' }),
          h('th', { scope: 'col', class: 'num' }, 'Cost ', h('span', { class: 'est', text: 'EST.' })))),
        h('tbody', null, rows.map(row => h('tr', null,
          h('td', null, h('span', { class: 'tool-name', text: row.model })),
          h('td', { class: 'num', text: fmtTokens(row.input), title: fmtInt(row.input) }),
          h('td', { class: 'num muted', text: fmtTokens(row.cacheRead + row.cacheWrite), title: `${fmtInt(row.cacheRead)} read · ${fmtInt(row.cacheWrite)} write` }),
          h('td', { class: 'num', text: fmtTokens(row.output), title: fmtInt(row.output) }),
          h('td', { class: 'num', text: fmtCost(row.costUsd) }))))))
        : h('div', { class: 'empty' }, h('p', { text: 'No token usage recorded yet. Copilot CLI writes totals when the session ends.' }))));
  }

  // ---------- global keys ----------
  document.addEventListener('keydown', event => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '/' && !typing) {
      const search = document.getElementById('search');
      if (search) { event.preventDefault(); search.focus(); search.select(); }
    } else if (event.key === 't' && !typing) {
      cycleTheme();
    } else if (event.key === 'r' && !typing && parseRoute().name === 'home') {
      state.routeKey = '';
      route();
    } else if (event.key === 'Escape' && !typing && parseRoute().name === 'run') {
      location.hash = backHref().slice(1) || '/';
    }
  });

  window.addEventListener('hashchange', route);
  route();
})();
