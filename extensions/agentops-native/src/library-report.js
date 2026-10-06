'use strict';

// Count only fixed operation classes in an already filtered, bounded receipt.
// Generic library traces have no Copilot session ID, so keep these counts separate.
function libraryReceiptCounts(text) {
  const seen = new Set();
  const counts = { librarySpanCount: 0, httpSpanCount: 0, databaseSpanCount: 0 };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    for (const resource of row.resourceSpans || []) {
      for (const scope of resource.scopeSpans || []) {
        for (const span of scope.spans || []) {
          if (!/^[a-f0-9]{32}$/i.test(span.traceId || '') || !/^[a-f0-9]{16}$/i.test(span.spanId || '')) continue;
          const kind = (span.attributes || []).find(item => item.key === 'agentops.operation.kind')?.value?.stringValue;
          if (!['http', 'database'].includes(kind)) continue;
          const identity = `${span.traceId.toLowerCase()}:${span.spanId.toLowerCase()}`;
          if (seen.has(identity)) continue;
          seen.add(identity);
          counts.librarySpanCount++;
          counts[kind === 'http' ? 'httpSpanCount' : 'databaseSpanCount']++;
        }
      }
    }
  }
  return counts;
}
module.exports = { libraryReceiptCounts };
