// Shared, minimal metadata-only sanitizers. Pulled out of v2-ask-context.js
// (rather than imported from it directly) so other local, non-KQL
// investigation helpers can reuse the exact same "safe metadata" definition
// without creating a require cycle through v2-ask-context.js -> ../legacy ->
// legacy-runtime.js, which wires those helpers back into the CLI.
function safeMetadataValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9_.:/@+ -]*$/.test(value)) return value;
  return null;
}

function selectMetadata(row, fields) {
  return Object.fromEntries(fields
    .filter(field => row[field] !== undefined)
    .map(field => [field, safeMetadataValue(row[field])])
    .filter(([, value]) => value !== null));
}

module.exports = {
  safeMetadataValue,
  selectMetadata
};
