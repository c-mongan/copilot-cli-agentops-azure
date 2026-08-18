function normalizeColumns(columns, label) {
  if (!Array.isArray(columns)) throw new TypeError(`${label} columns must be an array`);
  const normalized = [];
  const seen = new Set();
  for (const column of columns) {
    const name = String(column?.name || '').trim();
    const type = String(column?.type || '').trim().toLowerCase();
    if (!name || !type) throw new Error(`${label} contains a column without a name or type`);
    if (seen.has(name)) throw new Error(`${label} contains duplicate column ${name}`);
    seen.add(name);
    normalized.push({ name, type });
  }
  return normalized;
}

function validateAdditiveSchemaMigration(liveColumns, desiredColumns) {
  const live = normalizeColumns(liveColumns, 'live');
  const desired = normalizeColumns(desiredColumns, 'desired');
  const desiredByName = new Map(desired.map(column => [column.name, column.type]));
  const violations = live.flatMap(column => {
    const desiredType = desiredByName.get(column.name);
    if (!desiredType) return [{ column: column.name, live_type: column.type, desired_type: null, issue: 'would_remove_live_column' }];
    if (desiredType !== column.type) return [{ column: column.name, live_type: column.type, desired_type: desiredType, issue: 'would_change_existing_type' }];
    return [];
  });
  return {
    ok: violations.length === 0,
    additive_columns: desired.filter(column => !live.some(existing => existing.name === column.name)),
    violations
  };
}

function matchingBracket(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '[') depth += 1;
    if (text[index] === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('AgentOpsEvents_CL columns array is not closed');
}

function agentOpsEventsColumnsFromBicep(source) {
  const text = String(source || '');
  const tableStart = text.indexOf("name: 'AgentOpsEvents_CL'");
  if (tableStart < 0) throw new Error('AgentOpsEvents_CL table was not found in v2-ingestion Bicep');
  const columnsLabel = text.indexOf('columns:', tableStart);
  const arrayStart = text.indexOf('[', columnsLabel);
  if (columnsLabel < 0 || arrayStart < 0) throw new Error('AgentOpsEvents_CL columns were not found in v2-ingestion Bicep');
  const body = text.slice(arrayStart + 1, matchingBracket(text, arrayStart));
  const columns = [...body.matchAll(/\{\s*name:\s*'([^']+)'\s*,\s*type:\s*'([^']+)'\s*\}/g)]
    .map(match => ({ name: match[1], type: match[2].toLowerCase() }));
  return normalizeColumns(columns, 'AgentOpsEvents_CL desired');
}

function validateAgentOpsEventsBicepMigration(source, liveColumns) {
  const desiredColumns = agentOpsEventsColumnsFromBicep(source);
  const migration = validateAdditiveSchemaMigration(liveColumns, desiredColumns);
  const desired = new Map(desiredColumns.map(column => [column.name, column.type]));
  const contract = [
    ['EstimatedCostUsd', 'long'],
    ['EstimatedCostUsdReal', 'real'],
    ['EventId', 'string'],
    ['Sequence', 'long']
  ].flatMap(([column, type]) => desired.get(column) === type
    ? []
    : [{ column, expected_type: type, desired_type: desired.get(column) || null, issue: 'required_contract_mismatch' }]);
  return { ...migration, ok: migration.ok && contract.length === 0, contract_violations: contract, desired_columns: desiredColumns };
}

module.exports = {
  agentOpsEventsColumnsFromBicep,
  normalizeColumns,
  validateAdditiveSchemaMigration,
  validateAgentOpsEventsBicepMigration
};
