'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { validateEnterpriseAccess } = require('./check-enterprise-access');
const subscription = '00000000-0000-4000-8000-000000000001';
const principal = { objectId: '00000000-0000-4000-8000-000000000002', principalType: 'Group' };
const id = `/subscriptions/${subscription}/resourceGroups/qualification/providers/Microsoft.OperationalInsights/workspaces/metadata-law`;
const parameters = readers => ({ parameters: { workspaceName: { value: 'metadata-law' }, metadataReaders: { value: readers } } });
const snapshot = feature => ({ id, properties: { features: { enableLogAccessUsingOnlyResourcePermissions: feature } } });
test('empty owner-only candidate preserves current resource-permission mode without claiming team qualification', () => {
  const result = validateEnterpriseAccess(parameters([]), snapshot(true), subscription, 'qualification');
  assert.equal(result.metadata_reader_count, 0);
  assert.equal(result.team_access_qualified, false);
  assert.equal(result.workspace_access_mode_verified, false);
});
test('team grants fail closed for resource permission mode or missing access-mode evidence', () => {
  for (const feature of [true, undefined, null, 'false']) {
    assert.throws(() => validateEnterpriseAccess(parameters([principal]), snapshot(feature), subscription, 'qualification'), /Require workspace permissions/);
  }
});
test('workspace-permission mode permits the prepared assignment but never claims live data isolation', () => {
  const result = validateEnterpriseAccess(parameters([principal]), snapshot(false), subscription, 'qualification');
  assert.equal(result.workspace_access_mode_verified, true);
  assert.equal(result.team_access_qualified, false);
});
test('wrong workspace target, unknown type, malformed identity and duplicate identity fail closed', () => {
  assert.throws(() => validateEnterpriseAccess(parameters([]), { ...snapshot(false), id: `${id}-wrong` }, subscription, 'qualification'), /does not match/);
  for (const readers of [[{ ...principal, principalType: 'Unknown' }], [{ ...principal, objectId: 'display-name' }], [principal, principal]]) {
    assert.throws(() => validateEnterpriseAccess(parameters(readers), snapshot(false), subscription, 'qualification'));
  }
});
