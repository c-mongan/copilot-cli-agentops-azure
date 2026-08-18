const { tableNames } = require('../demo/agentops-demo-data');
const { AGENTOPS_SCHEMA_VERSION } = require('../schema/agentops-attributes');

const schemaVersionTables = new Set(tableNames.filter(table => table.endsWith('_CL')));

const schemaMigrationPolicy = {
  current_version: AGENTOPS_SCHEMA_VERSION,
  supported_versions: [AGENTOPS_SCHEMA_VERSION],
  legacy_versions: ['1'],
  missing_version_action: 'Regenerate or roll up telemetry with the current AgentOps CLI so every AgentOps*_CL row includes SchemaVersion.',
  legacy_version_action: 'Regenerate the affected AgentOps*_CL files or re-run the local rollup before cloud ingestion.',
  unsupported_newer_version_action: 'Upgrade the AgentOps CLI and Grafana dashboard pack before ingesting newer schema rows.'
};

function schemaVersionFor(table, rows) {
  if (!schemaVersionTables.has(table) || rows.length === 0) {
    const migration = schemaMigrationFor({ table, missingRows: 0, versions: [] });
    return {
      checked: false,
      expected: AGENTOPS_SCHEMA_VERSION,
      versions: [],
      missing_rows: 0,
      mismatched_versions: [],
      migration,
      ok: true
    };
  }

  const versions = versionCounts(rows);
  const missingRows = rows.filter(row => row?.SchemaVersion === undefined || row?.SchemaVersion === null || row?.SchemaVersion === '').length;
  const mismatchedVersions = Object.keys(versions).filter(version => version !== AGENTOPS_SCHEMA_VERSION);
  const migration = schemaMigrationFor({ table, missingRows, versions: Object.keys(versions) });

  return {
    checked: true,
    expected: AGENTOPS_SCHEMA_VERSION,
    versions: Object.keys(versions).sort(),
    version_counts: versions,
    missing_rows: missingRows,
    mismatched_versions: mismatchedVersions,
    migration,
    ok: missingRows === 0 && mismatchedVersions.length === 0
  };
}

function versionCounts(rows) {
  const counts = {};
  for (const row of rows) {
    const version = row?.SchemaVersion;
    if (version === undefined || version === null || version === '') continue;
    const key = String(version);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function schemaMigrationFor({ table, missingRows, versions }) {
  const legacyVersions = versions.filter(version => schemaMigrationPolicy.legacy_versions.includes(version));
  const unsupportedVersions = versions.filter(version => !schemaMigrationPolicy.supported_versions.includes(version) && !schemaMigrationPolicy.legacy_versions.includes(version));
  const actions = [];
  if (missingRows > 0) actions.push(`schema migration required for ${missingRows} missing-version row(s): ${schemaMigrationPolicy.missing_version_action}`);
  if (legacyVersions.length > 0) actions.push(`schema migration required from version(s) ${legacyVersions.join(', ')} to ${AGENTOPS_SCHEMA_VERSION}: ${schemaMigrationPolicy.legacy_version_action}`);
  if (unsupportedVersions.length > 0) actions.push(`unsupported newer schema version(s) ${unsupportedVersions.join(', ')}: ${schemaMigrationPolicy.unsupported_newer_version_action}`);

  return {
    table,
    status: unsupportedVersions.length > 0
      ? 'unsupported-newer'
      : missingRows > 0
        ? 'missing-version'
        : legacyVersions.length > 0
          ? 'legacy-migration-required'
          : 'current',
    migration_required: missingRows > 0 || legacyVersions.length > 0 || unsupportedVersions.length > 0,
    compatible_for_ingest: unsupportedVersions.length === 0,
    legacy_versions: legacyVersions,
    unsupported_versions: unsupportedVersions,
    actions
  };
}

function schemaVersioningSummary(tables) {
  const checked = Object.entries(tables)
    .filter(([, table]) => table.schema_version?.checked)
    .map(([name, table]) => ({ name, ...table.schema_version }));
  const missingRows = checked.reduce((total, table) => total + table.missing_rows, 0);
  const mismatchedTables = checked
    .filter(table => table.mismatched_versions.length > 0)
    .map(table => ({
      table: table.name,
      versions: table.mismatched_versions
    }));

  return {
    ok: missingRows === 0 && mismatchedTables.length === 0,
    expected: AGENTOPS_SCHEMA_VERSION,
    checked_tables: checked.length,
    missing_rows: missingRows,
    mismatched_tables: mismatchedTables
  };
}

function schemaMigrationSummary(tables) {
  const migrations = Object.entries(tables)
    .filter(([, table]) => table.schema_version?.migration?.migration_required)
    .map(([name, table]) => ({
      table: name,
      status: table.schema_version.migration.status,
      compatible_for_ingest: table.schema_version.migration.compatible_for_ingest,
      versions: table.schema_version.versions,
      missing_rows: table.schema_version.missing_rows,
      actions: table.schema_version.migration.actions
    }));
  const unsupportedTables = migrations
    .filter(migration => migration.compatible_for_ingest === false)
    .map(migration => ({
      table: migration.table,
      versions: tables[migration.table].schema_version.migration.unsupported_versions
    }));

  return {
    current_version: schemaMigrationPolicy.current_version,
    supported_versions: schemaMigrationPolicy.supported_versions,
    legacy_versions: schemaMigrationPolicy.legacy_versions,
    ok: unsupportedTables.length === 0,
    migration_required: migrations.length > 0,
    migrations,
    unsupported_tables: unsupportedTables,
    actions: migrations.flatMap(migration => migration.actions)
  };
}

module.exports = {
  schemaMigrationPolicy,
  schemaMigrationSummary,
  schemaVersionFor,
  schemaVersioningSummary
};
