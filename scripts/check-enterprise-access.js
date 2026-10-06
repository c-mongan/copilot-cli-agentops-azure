#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');

function validateEnterpriseAccess(parametersDocument, workspaceSnapshot, subscriptionId, resourceGroupName) {
  const parameters = parametersDocument.parameters;
  assert(parameters && typeof parameters.workspaceName?.value === 'string', 'Missing workspaceName parameter');
  const expectedId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.OperationalInsights/workspaces/${parameters.workspaceName.value}`;
  assert.equal(String(workspaceSnapshot.id || '').toLowerCase(), expectedId.toLowerCase(), 'Workspace snapshot does not match selected subscription, resource group and workspace');
  for (const key of ['observers', 'editors', 'publishers', 'metadataReaders']) {
    const principals = parameters[key]?.value || [];
    assert(Array.isArray(principals), `${key} must be an array`);
    const seen = new Set();
    for (const principal of principals) {
      assert.match(principal.objectId || '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, `${key}: invalid immutable object GUID`);
      assert(['Group', 'ServicePrincipal', 'User'].includes(principal.principalType), `${key}: explicit principalType required`);
      assert(!seen.has(principal.objectId.toLowerCase()), `${key}: duplicate objectId`);
      seen.add(principal.objectId.toLowerCase());
    }
  }
  const readers = parameters.metadataReaders?.value || [];
  const resourcePermissions = workspaceSnapshot.properties?.features?.enableLogAccessUsingOnlyResourcePermissions;
  if (readers.length > 0) {
    assert.equal(resourcePermissions, false, 'Nonempty metadataReaders require verified Require workspace permissions (features.enableLogAccessUsingOnlyResourcePermissions=false). Stop; obtain a separately reviewed narrow workspace-setting change and fresh readback. Do not deploy team grants using an Owner-only proof.');
  }
  return { workspace_resource_id: expectedId, metadata_reader_count: readers.length, workspace_access_mode_verified: resourcePermissions === false, team_access_qualified: false };
}

if (require.main === module) {
  const [parametersPath, snapshotPath, subscriptionId, resourceGroupName] = process.argv.slice(2);
  assert(parametersPath && snapshotPath && subscriptionId && resourceGroupName, 'Usage: node scripts/check-enterprise-access.js <parameters.json> <workspace-arm-snapshot.json> <subscription-id> <resource-group>');
  const result = validateEnterpriseAccess(JSON.parse(fs.readFileSync(parametersPath, 'utf8')), JSON.parse(fs.readFileSync(snapshotPath, 'utf8')), subscriptionId, resourceGroupName);
  console.log(JSON.stringify(result, null, 2));
}
module.exports = { validateEnterpriseAccess };
