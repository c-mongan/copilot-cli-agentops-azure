function benchmarkArtifactFileRefs(report = null) {
  const rows = [];
  for (const task of Array.isArray(report?.tasks) ? report.tasks : []) {
    const diff = task.artifactDiff || {};
    for (const change of ['added', 'modified', 'deleted']) {
      const files = Array.isArray(diff[change]) ? diff[change] : [];
      for (const file of files) {
        const artifactPath = String(file || '').replaceAll('\\', '/').trim();
        if (!artifactPath) continue;
        rows.push({
          task_id: task.taskId || '',
          change,
          path: artifactPath
        });
      }
    }
  }
  return rows.slice(0, 200);
}

function benchmarkArtifactContentDiffRefs(report = null) {
  const rows = [];
  for (const task of Array.isArray(report?.tasks) ? report.tasks : []) {
    const explicitDiffs = Array.isArray(task.artifactContentDiffs) ? task.artifactContentDiffs : [];
    for (const diff of explicitDiffs) {
      if (!diff || typeof diff !== 'object') continue;
      const artifactPath = String(diff.path || diff.file || '').replaceAll('\\', '/').trim();
      if (!artifactPath) continue;
      rows.push({
        task_id: task.taskId || '',
        change: diff.change || diff.status || '',
        path: artifactPath,
        diff_preview: String(diff.diff || diff.preview || '').split(/\r?\n/).slice(0, 80).join('\n').slice(0, 12000)
      });
    }

    const files = Array.isArray(task.artifactReview?.files) ? task.artifactReview.files : [];
    for (const file of files) {
      const artifactPath = String(file.path || file.file || '').replaceAll('\\', '/').trim();
      const diffLines = Array.isArray(file.diff) ? file.diff : [];
      if (!artifactPath || diffLines.length === 0) continue;
      rows.push({
        task_id: task.taskId || '',
        change: file.change || file.status || '',
        path: artifactPath,
        diff_preview: diffLines.map(line => String(line).slice(0, 300)).slice(0, 80).join('\n')
      });
    }
  }
  return rows.filter(row => row.diff_preview).slice(0, 50);
}

function benchmarkHiddenCheckPackRefs(report = null) {
  const rows = [];
  for (const task of Array.isArray(report?.tasks) ? report.tasks : []) {
    const packs = Array.isArray(task.hiddenCheckPacks) ? task.hiddenCheckPacks : [];
    for (const pack of packs) {
      if (!pack || typeof pack !== 'object') continue;
      rows.push({
        task_id: task.taskId || '',
        id: pack.id || '',
        title: pack.title || pack.id || '',
        command_count: pack.commandCount ?? null
      });
    }
  }
  return rows.slice(0, 200);
}

function benchmarkPolicyRefs(report = null) {
  const rows = [];
  for (const task of Array.isArray(report?.tasks) ? report.tasks : []) {
    const violations = Array.isArray(task.toolPolicyViolations) ? task.toolPolicyViolations : [];
    rows.push({
      task_id: task.taskId || '',
      permission_profile: task.permissionProfile || '',
      os_sandbox_mode: task.osSandbox?.mode || '',
      os_sandbox_active: task.osSandboxRuntime?.active === undefined ? null : Boolean(task.osSandboxRuntime.active),
      policy_blocks: task.policyBlocks ?? null,
      blocked_risks: Array.isArray(task.toolPolicy?.blockedRisks) ? task.toolPolicy.blockedRisks : [],
      violation_count: violations.length,
      violation_risks: [...new Set(violations.map(violation => violation?.risk).filter(Boolean))].sort()
    });
  }
  return rows.slice(0, 200);
}

function benchmarkSemanticCheckRefs(report = null) {
  const rows = [];
  for (const task of Array.isArray(report?.tasks) ? report.tasks : []) {
    const checks = Array.isArray(task.semanticChecks) ? task.semanticChecks : [];
    for (const check of checks) {
      if (!check || typeof check !== 'object') continue;
      rows.push({
        task_id: task.taskId || '',
        id: check.id || '',
        adapter: check.adapter || '',
        file: check.file || '',
        ok: check.ok === undefined ? null : Boolean(check.ok),
        score: check.score ?? null,
        detail: check.detail || ''
      });
    }
  }
  return rows.slice(0, 200);
}

function benchmarkEvidenceFromReport(report = null) {
  if (!report || typeof report !== 'object') return null;
  const artifactDiff = report.artifactDiff || {};
  const approval = report.promotion?.approval || report.promotionApproval || {};
  const approvalSource = approval.source
    ? String(approval.source).split(/[\\/]/).filter(Boolean).pop() || String(approval.source)
    : '';
  return {
    run_id: report.runId || '',
    decision: report.ok === false ? 'missing' : (report.promotion?.decision || report.recommendation?.action || ''),
    pass_rate_pct: report.passRatePct ?? null,
    average_score: report.averageScore ?? null,
    safety_violation_count: report.safetyViolationCount ?? null,
    tool_failures: report.toolFailures ?? null,
    total_tokens: report.totalTokens ?? null,
    cost: report.cost ?? null,
    artifact_diff: {
      added: artifactDiff.added ?? null,
      modified: artifactDiff.modified ?? null,
      deleted: artifactDiff.deleted ?? null,
      total_changed: artifactDiff.totalChanged ?? null
    },
    artifact_files: benchmarkArtifactFileRefs(report),
    artifact_content_diffs: benchmarkArtifactContentDiffRefs(report),
    hidden_checks: {
      passed: report.hiddenChecks?.passed ?? null,
      failed: report.hiddenChecks?.failed ?? null,
      packs: benchmarkHiddenCheckPackRefs(report)
    },
    policy: {
      blocks: report.policyBlocks ?? null,
      permission_profiles: report.permissionProfiles || {},
      tasks: benchmarkPolicyRefs(report)
    },
    semantic_checks: {
      count: report.semanticChecks?.count ?? null,
      average_score: report.semanticChecks?.averageScore ?? null,
      checks: benchmarkSemanticCheckRefs(report)
    },
    approval: {
      status: approval.status || '',
      approved_count: approval.status === 'approved' ? (approval.approvedBy || []).length : 0,
      required_count: report.promotion?.gates?.requiredApprovals ?? report.promotionGates?.requiredApprovals ?? null,
      approved_at: approval.approvedAt || '',
      ticket: approval.ticket || '',
      source: approvalSource
    },
    validation: report.promotion?.validation || report.message || '',
    rollback: report.promotion?.rollback || (report.ok === false ? 'run or attach benchmark evidence before promotion' : '')
  };
}

module.exports = {
  benchmarkEvidenceFromReport
};
