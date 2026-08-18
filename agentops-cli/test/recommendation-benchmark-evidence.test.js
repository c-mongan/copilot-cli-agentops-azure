const assert = require('node:assert/strict');
const test = require('node:test');

const { benchmarkEvidenceFromReport } = require('../src/lib/recommendation-benchmark-evidence');

test('recommendation benchmark evidence summarizes artifacts policy checks and approval', () => {
  const evidence = benchmarkEvidenceFromReport({
    runId: 'bench-candidate',
    passRatePct: 50,
    averageScore: 61,
    safetyViolationCount: 0,
    toolFailures: 1,
    totalTokens: 12000,
    cost: 0.42,
    artifactDiff: {
      added: 1,
      modified: 2,
      deleted: 0,
      totalChanged: 3
    },
    hiddenChecks: {
      passed: 1,
      failed: 0
    },
    policyBlocks: 1,
    permissionProfiles: { 'allow-all-isolated': 1 },
    semanticChecks: { count: 1, averageScore: 100 },
    tasks: [{
      taskId: 'create-note',
      permissionProfile: 'allow-all-isolated',
      osSandbox: { mode: 'macos-network-blocked' },
      osSandboxRuntime: { active: true },
      toolPolicy: { blockedRisks: ['network', 'secret-access'] },
      policyBlocks: 1,
      toolPolicyViolations: [{ tool: 'http_fetch_url', risk: 'network' }],
      semanticChecks: [{
        id: 'hello-note-content',
        adapter: 'file-contains',
        file: 'notes/hello.txt',
        ok: true,
        score: 100,
        detail: null
      }],
      hiddenCheckPacks: [{
        id: 'create-note-sealed',
        title: 'Create note sealed checks',
        commandCount: 1
      }],
      artifactDiff: {
        added: ['notes/hello.txt'],
        modified: ['README.md', 'package.json'],
        deleted: ['old.txt']
      },
      artifactContentDiffs: [{
        change: 'modified',
        path: 'README.md',
        diff: '--- a/README.md\n+++ b/README.md\n-Old\n+New'
      }],
      artifactReview: {
        files: [{
          change: 'added',
          path: 'notes/hello.txt',
          diff: ['+hello']
        }]
      }
    }],
    promotion: {
      decision: 'reject',
      gates: { requiredApprovals: 1 },
      approval: {
        status: 'approved',
        approvedBy: ['sre-team'],
        approvedAt: '2026-06-03T04:00:00Z',
        ticket: 'APPROVAL-123',
        source: '/tmp/approval.json'
      },
      validation: 'benchmark summary includes local checks',
      rollback: 'do not promote until failures are explained'
    }
  });

  assert.equal(evidence.run_id, 'bench-candidate');
  assert.equal(evidence.decision, 'reject');
  assert.deepEqual(evidence.artifact_diff, { added: 1, modified: 2, deleted: 0, total_changed: 3 });
  assert.deepEqual(evidence.artifact_files, [
    { task_id: 'create-note', change: 'added', path: 'notes/hello.txt' },
    { task_id: 'create-note', change: 'modified', path: 'README.md' },
    { task_id: 'create-note', change: 'modified', path: 'package.json' },
    { task_id: 'create-note', change: 'deleted', path: 'old.txt' }
  ]);
  assert.equal(evidence.artifact_content_diffs.length, 2);
  assert.equal(evidence.hidden_checks.packs[0].id, 'create-note-sealed');
  assert.equal(evidence.policy.tasks[0].os_sandbox_active, true);
  assert.deepEqual(evidence.policy.tasks[0].violation_risks, ['network']);
  assert.equal(evidence.semantic_checks.checks[0].id, 'hello-note-content');
  assert.equal(evidence.approval.approved_count, 1);
  assert.equal(evidence.approval.required_count, 1);
  assert.equal(evidence.approval.source, 'approval.json');
});

test('recommendation benchmark evidence reports missing benchmark summaries', () => {
  const evidence = benchmarkEvidenceFromReport({
    runId: 'missing-bench',
    ok: false,
    message: 'no benchmark summaries were found for this run'
  });

  assert.equal(evidence.run_id, 'missing-bench');
  assert.equal(evidence.decision, 'missing');
  assert.match(evidence.validation, /no benchmark summaries/);
  assert.match(evidence.rollback, /before promotion/);
  assert.equal(benchmarkEvidenceFromReport(null), null);
});
