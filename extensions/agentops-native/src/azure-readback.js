'use strict';

// Typed, read-only readback of native metadata events this window published.
// The query text is fixed; only validated event IDs and a bounded lookback are
// interpolated. Responses are never echoed: they can carry account details.
const queryOrigin = 'https://api.loganalytics.io';
const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const eventIdPattern = /^native_[a-f0-9]{32}$/;
const maximumReadbackIds = 500;
const maximumResponseBytes = 4 * 1024 * 1024;
const expectedFields = Object.freeze({
  EventName: 'native.span.observed', Surface: 'native-otel', SchemaVersion: '2',
  PrivacyMode: 'strict', ContentCaptureMode: 'off'
});

function readbackQuery(eventIds, lookbackDays) {
  const ids = eventIds.map(id => `'${id}'`).join(',');
  return `AgentOpsEvents_CL | where TimeGenerated > ago(${lookbackDays}d) | where EventId in (${ids}) `
    + `| project EventId, ${Object.keys(expectedFields).join(', ')}`;
}

function selectEventIds(eventIds) {
  if (!Array.isArray(eventIds) || !eventIds.length) throw new Error('No published events are available for readback.');
  const unique = [...new Set(eventIds)];
  if (!unique.every(id => typeof id === 'string' && eventIdPattern.test(id))) throw new Error('Readback event IDs are invalid.');
  return { ids: unique.slice(0, maximumReadbackIds), sampled: unique.length > maximumReadbackIds, total: unique.length };
}

async function boundedText(response) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximumResponseBytes) throw new Error('Readback response is too large.');
  const text = await response.text();
  if (Buffer.byteLength(text) > maximumResponseBytes) throw new Error('Readback response is too large.');
  return text;
}

function rowsFrom(body) {
  const table = body?.tables?.[0];
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new Error('Readback response has no result table.');
  const names = table.columns.map(column => column?.name);
  for (const name of ['EventId', ...Object.keys(expectedFields)]) {
    if (!names.includes(name)) throw new Error('Readback response is missing an expected column.');
  }
  return table.rows.map(row => Object.fromEntries(names.map((name, index) => [name, Array.isArray(row) ? row[index] : undefined])));
}

async function readBackNativeEvents(options = {}) {
  const { workspaceId, tokenProvider, signal } = options;
  if (typeof workspaceId !== 'string' || !guid.test(workspaceId)) throw new Error('Readback requires a Log Analytics workspace ID.');
  if (typeof tokenProvider !== 'function') throw new Error('Readback requires an identity provider.');
  const lookbackDays = options.lookbackDays ?? 7;
  if (!Number.isSafeInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 30) throw new Error('Readback lookback is invalid.');
  const selection = selectEventIds(options.eventIds);
  const doFetch = options.fetch || globalThis.fetch;
  const token = await tokenProvider();
  if (typeof token !== 'string' || !token.trim()) throw new Error('Readback requires Microsoft sign-in.');
  let response;
  try {
    response = await doFetch(`${queryOrigin}/v1/workspaces/${workspaceId.toLowerCase()}/query`, {
      method: 'POST', redirect: 'error', signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: readbackQuery(selection.ids, lookbackDays), timespan: `P${lookbackDays}D` })
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Readback was cancelled.');
    throw new Error('Readback request did not complete.');
  }
  if (response.status === 401 || response.status === 403) return { state: 'denied', expected: selection.ids.length, sampled: selection.sampled, total: selection.total };
  if (!response.ok) throw new Error(`Readback query failed with HTTP ${Number(response.status) || 'error'}.`);
  let body;
  try { body = JSON.parse(await boundedText(response)); } catch (error) {
    throw new Error(error.message === 'Readback response is too large.' ? error.message : 'Readback response is not valid JSON.');
  }
  const wanted = new Set(selection.ids);
  const seen = new Map();
  let unexpected = 0;
  for (const row of rowsFrom(body)) {
    if (!wanted.has(row.EventId)) { unexpected++; continue; }
    const typed = Object.entries(expectedFields).every(([field, value]) => row[field] === value);
    const prior = seen.get(row.EventId);
    seen.set(row.EventId, { copies: (prior?.copies || 0) + 1, typed: (prior?.typed ?? true) && typed });
  }
  const found = seen.size;
  const mismatched = [...seen.values()].filter(entry => !entry.typed).length;
  const duplicates = [...seen.values()].reduce((sum, entry) => sum + entry.copies - 1, 0);
  const expected = selection.ids.length;
  const state = unexpected || mismatched ? 'mismatch' : found === expected ? 'verified' : found ? 'partial' : 'missing';
  return { state, expected, found, missing: expected - found, mismatched, duplicates, unexpected, sampled: selection.sampled, total: selection.total, lookbackDays };
}

module.exports = { readBackNativeEvents, readbackQuery, selectEventIds, expectedFields, maximumReadbackIds, queryOrigin };
