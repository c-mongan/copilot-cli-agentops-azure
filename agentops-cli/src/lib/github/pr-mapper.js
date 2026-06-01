const crypto = require('node:crypto');

const { ciStatusFromChecks } = require('./actions-mapper');
const { isRevertPullRequest } = require('./revert-detector');

function stableHash(value, prefix = 'h') {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)}`;
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

function rowFromPullRequest(pr, options = {}) {
  const repo = options.repo || pr.repository?.nameWithOwner || 'unknown-repo';
  const branch = pr.headRefName || pr.headRef?.name || 'unknown-branch';
  const merged = Boolean(pr.mergedAt || pr.merged);
  const closed = Boolean(pr.closedAt || String(pr.state || '').toUpperCase() === 'CLOSED');
  const runStartedAt = options.runStartedAt || options.run?.TimeGenerated || '';
  const prCreatedAt = pr.createdAt || '';
  const prMergedAt = pr.mergedAt || '';
  const checks = pr.statusCheckRollup || pr.checks || [];
  const commitCount = Number(
    pr.commitsCount
    || pr.commits?.totalCount
    || (Array.isArray(pr.commits) ? pr.commits.length : 0)
  );
  return {
    TimeGenerated: pr.updatedAt || pr.createdAt || new Date().toISOString(),
    RunId: options.runId || stableHash(`${repo}:${branch}:${pr.number || pr.id}`, 'run'),
    RepoHash: stableHash(repo, 'repo'),
    BranchHash: stableHash(branch, 'branch'),
    RunStartedAt: runStartedAt,
    PrCreatedAt: prCreatedAt,
    PrMergedAt: prMergedAt,
    TimeToPrMinutes: minutesBetween(runStartedAt, prCreatedAt),
    TimeToMergeMinutes: minutesBetween(runStartedAt, prMergedAt),
    PrOpened: true,
    PrNumberHash: stableHash(`${repo}#${pr.number || pr.id}`, 'pr'),
    PrMerged: merged,
    PrClosed: closed && !merged,
    PrReverted: isRevertPullRequest(pr),
    CiStatus: pr.ciStatus || ciStatusFromChecks(checks),
    ReviewCommentCount: Number(pr.reviewDecision === 'CHANGES_REQUESTED' ? 1 : 0) + Number(pr.commentsCount || pr.reviewComments || 0),
    CommitCount: commitCount,
    FilesChangedCount: Number(pr.changedFiles || pr.filesChanged || 0)
  };
}

module.exports = {
  minutesBetween,
  rowFromPullRequest,
  stableHash
};
