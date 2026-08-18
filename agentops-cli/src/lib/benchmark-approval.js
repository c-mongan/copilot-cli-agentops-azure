const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { isPlainObject, isStringArray } = require('./benchmark-validation');
const { writeJsonFile } = require('./command-output');
const { readJson } = require('./json');

function validateBenchmarkExternalReview(review, source = 'approval') {
  if (review === undefined || review === null) return null;
  if (!isPlainObject(review)) {
    throw new Error(`Invalid benchmark promotion approval ${source}: externalReview must be an object`);
  }

  const normalized = {};
  for (const field of ['system', 'id', 'url']) {
    if (review[field] === undefined) continue;
    if (typeof review[field] !== 'string' || review[field].trim() === '') {
      throw new Error(`Invalid benchmark promotion approval ${source}: externalReview.${field} must be a non-empty string`);
    }
    normalized[field] = review[field].trim();
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error(`Invalid benchmark promotion approval ${source}: externalReview must include system, id, or url`);
  }

  const status = review.status || 'approved';
  if (!['approved', 'pending', 'rejected'].includes(status)) {
    throw new Error(`Invalid benchmark promotion approval ${source}: externalReview.status must be approved, pending, or rejected`);
  }

  return {
    status,
    ...normalized
  };
}

function parseGitHubExternalReviewTarget(review) {
  const url = review.url || '';
  const urlMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  if (urlMatch) {
    return {
      repo: `${urlMatch[1]}/${urlMatch[2]}`,
      pr: urlMatch[3]
    };
  }

  const id = review.id || '';
  const repoIdMatch = id.match(/^([^/\s]+\/[^#\s]+)#(\d+)$/);
  if (repoIdMatch) {
    return {
      repo: repoIdMatch[1],
      pr: repoIdMatch[2]
    };
  }

  return null;
}

function verifyGitHubExternalReview(review, options = {}) {
  const target = parseGitHubExternalReviewTarget(review);
  if (!target) {
    return {
      provider: 'github',
      ok: false,
      status: 'pending',
      error: 'GitHub review verification requires a pull request URL or owner/repo#number id'
    };
  }

  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const result = spawnSync('gh', [
    'pr',
    'view',
    target.pr,
    '--repo',
    target.repo,
    '--json',
    'reviewDecision,state,mergedAt,url,number'
  ], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    return {
      provider: 'github',
      ok: false,
      status: 'pending',
      repo: target.repo,
      number: Number(target.pr),
      error: (result.stderr || result.stdout || 'gh pr view failed').trim()
    };
  }

  let payload = {};
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      provider: 'github',
      ok: false,
      status: 'pending',
      repo: target.repo,
      number: Number(target.pr),
      error: `gh pr view returned invalid JSON: ${error.message}`
    };
  }

  const reviewDecision = String(payload.reviewDecision || '').toUpperCase();
  const state = String(payload.state || '').toUpperCase();
  const merged = Boolean(payload.mergedAt) || state === 'MERGED';
  const ok = reviewDecision === 'APPROVED' || merged;
  const status = ok ? 'approved' : (reviewDecision === 'CHANGES_REQUESTED' || state === 'CLOSED' ? 'rejected' : 'pending');

  return {
    provider: 'github',
    ok,
    status,
    repo: target.repo,
    number: Number(payload.number || target.pr),
    url: payload.url || review.url || null,
    reviewDecision: reviewDecision || null,
    state: state || null,
    merged
  };
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseAzureDevOpsExternalReviewTarget(review) {
  const url = review.url || '';
  let urlMatch = url.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)(?:[/?#].*)?$/i);
  if (urlMatch) {
    return {
      organizationUrl: `https://dev.azure.com/${urlMatch[1]}`,
      project: safeDecodeURIComponent(urlMatch[2]),
      repository: safeDecodeURIComponent(urlMatch[3]),
      pr: urlMatch[4]
    };
  }

  urlMatch = url.match(/^https?:\/\/([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)(?:[/?#].*)?$/i);
  if (urlMatch) {
    return {
      organizationUrl: `https://${urlMatch[1]}.visualstudio.com`,
      project: safeDecodeURIComponent(urlMatch[2]),
      repository: safeDecodeURIComponent(urlMatch[3]),
      pr: urlMatch[4]
    };
  }

  const id = review.id || '';
  const idMatch = id.match(/^([^/\s]+)\/([^/\s]+)\/([^#\s]+)#(\d+)$/);
  if (idMatch) {
    return {
      organizationUrl: `https://dev.azure.com/${idMatch[1]}`,
      project: idMatch[2],
      repository: idMatch[3],
      pr: idMatch[4]
    };
  }

  return null;
}

function verifyAzureDevOpsExternalReview(review, options = {}) {
  const target = parseAzureDevOpsExternalReviewTarget(review);
  if (!target) {
    return {
      provider: 'azure-devops',
      ok: false,
      status: 'pending',
      error: 'Azure DevOps review verification requires a pull request URL or org/project/repo#number id'
    };
  }

  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const result = spawnSync('az', [
    'repos',
    'pr',
    'show',
    '--id',
    target.pr,
    '--organization',
    target.organizationUrl,
    '--project',
    target.project,
    '--repository',
    target.repository,
    '--output',
    'json'
  ], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    return {
      provider: 'azure-devops',
      ok: false,
      status: 'pending',
      organizationUrl: target.organizationUrl,
      project: target.project,
      repository: target.repository,
      number: Number(target.pr),
      error: (result.stderr || result.stdout || 'az repos pr show failed').trim()
    };
  }

  let payload = {};
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      provider: 'azure-devops',
      ok: false,
      status: 'pending',
      organizationUrl: target.organizationUrl,
      project: target.project,
      repository: target.repository,
      number: Number(target.pr),
      error: `az repos pr show returned invalid JSON: ${error.message}`
    };
  }

  const pullRequestStatus = String(payload.status || '').toLowerCase();
  const reviewers = Array.isArray(payload.reviewers) ? payload.reviewers : [];
  const approvals = reviewers.filter(reviewer => Number(reviewer.vote || 0) >= 5).length;
  const rejections = reviewers.filter(reviewer => Number(reviewer.vote || 0) <= -5).length;
  const completed = pullRequestStatus === 'completed';
  const rejected = pullRequestStatus === 'abandoned' || rejections > 0;
  const ok = completed || (approvals > 0 && !rejected);

  return {
    provider: 'azure-devops',
    ok,
    status: ok ? 'approved' : (rejected ? 'rejected' : 'pending'),
    organizationUrl: target.organizationUrl,
    project: target.project,
    repository: target.repository,
    number: Number(payload.pullRequestId || target.pr),
    url: payload.url || review.url || null,
    pullRequestStatus: pullRequestStatus || null,
    approvals,
    rejections
  };
}

function safeUrlOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function parseJiraExternalReviewTarget(review) {
  const id = review.id || '';
  const idMatch = id.match(/[A-Z][A-Z0-9]+-\d+/);
  if (idMatch) return { key: idMatch[0] };

  const url = review.url || '';
  const urlMatch = url.match(/\/(?:browse|issues?)\/([A-Z][A-Z0-9]+-\d+)(?:[/?#].*)?$/);
  if (urlMatch) {
    return {
      key: urlMatch[1],
      baseUrl: safeUrlOrigin(url)
    };
  }

  return null;
}

function jiraApprovedStatuses(options = {}) {
  const configured = options.jiraApprovedStatuses || process.env.AGENTOPS_JIRA_APPROVED_STATUSES;
  const statuses = configured
    ? String(configured).split(',').map(status => status.trim().toLowerCase()).filter(Boolean)
    : [];
  return new Set(['approved', 'closed', 'done', 'resolved', ...statuses]);
}

function jiraApiBaseUrl(review, target) {
  if (target.baseUrl) return target.baseUrl;
  if (review.url) return safeUrlOrigin(review.url);
  if (process.env.JIRA_BASE_URL) return process.env.JIRA_BASE_URL.replace(/\/+$/, '');
  return null;
}

function fetchExternalReviewJson(url, options = {}) {
  if (options.fetchJson) return options.fetchJson(url, options);

  const headers = [];
  if (process.env.JIRA_API_TOKEN && process.env.JIRA_EMAIL) {
    const token = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
    headers.push('Authorization', `Basic ${token}`);
  } else if (process.env.JIRA_API_TOKEN) {
    headers.push('Authorization', `Bearer ${process.env.JIRA_API_TOKEN}`);
  }

  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const args = ['-fsSL', '--max-time', '10'];
  for (let index = 0; index < headers.length; index += 2) {
    args.push('-H', `${headers[index]}: ${headers[index + 1]}`);
  }
  args.push(url);

  const result = spawnSync('curl', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'curl failed').trim());
  }
  return JSON.parse(result.stdout || '{}');
}

function verifyJiraExternalReview(review, options = {}) {
  const target = parseJiraExternalReviewTarget(review);
  if (!target) {
    return {
      provider: 'jira',
      ok: false,
      status: 'pending',
      error: 'Jira review verification requires an issue key or Jira issue URL'
    };
  }

  const baseUrl = jiraApiBaseUrl(review, target);
  if (!baseUrl) {
    return {
      provider: 'jira',
      ok: false,
      status: 'pending',
      issueKey: target.key,
      error: 'Jira review verification requires a Jira issue URL or JIRA_BASE_URL'
    };
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/rest/api/3/issue/${encodeURIComponent(target.key)}?fields=status`;
  let payload = {};
  try {
    payload = fetchExternalReviewJson(url, options);
  } catch (error) {
    return {
      provider: 'jira',
      ok: false,
      status: 'pending',
      issueKey: target.key,
      url,
      error: error.message
    };
  }

  const issueStatus = payload.fields?.status || {};
  const statusName = String(issueStatus.name || '').toLowerCase();
  const categoryKey = String(issueStatus.statusCategory?.key || '').toLowerCase();
  const categoryName = String(issueStatus.statusCategory?.name || '').toLowerCase();
  const approved = categoryKey === 'done' || categoryName === 'done' || jiraApprovedStatuses(options).has(statusName);
  const rejected = ['canceled', 'cancelled', 'declined', 'rejected'].some(value => statusName.includes(value));

  return {
    provider: 'jira',
    ok: approved,
    status: approved ? 'approved' : (rejected ? 'rejected' : 'pending'),
    issueKey: payload.key || target.key,
    url: review.url || `${baseUrl.replace(/\/+$/, '')}/browse/${encodeURIComponent(target.key)}`,
    issueStatus: issueStatus.name || null,
    statusCategory: issueStatus.statusCategory?.key || issueStatus.statusCategory?.name || null
  };
}

function verifyBenchmarkExternalReview(review, options = {}) {
  if (!review) return null;
  const system = String(review.system || '').toLowerCase();
  if (system === 'github') return verifyGitHubExternalReview(review, options);
  if (['azure-devops', 'azdo', 'ado'].includes(system)) return verifyAzureDevOpsExternalReview(review, options);
  if (system === 'jira') return verifyJiraExternalReview(review, options);
  {
    return {
      provider: system || 'unknown',
      ok: false,
      status: 'pending',
      error: 'external review verification currently supports GitHub pull requests, Azure DevOps pull requests, and Jira issues only'
    };
  }
}

function validateBenchmarkPromotionApproval(approval, source = 'approval') {
  if (approval === undefined || approval === null) return null;
  if (!isPlainObject(approval)) {
    throw new Error(`Invalid benchmark promotion approval ${source}: approval must be an object`);
  }

  if (approval.approvedBy !== undefined && !isStringArray(approval.approvedBy)) {
    throw new Error(`Invalid benchmark promotion approval ${source}: approvedBy must be an array of strings`);
  }
  const approvedBy = approval.approvedBy === undefined
    ? []
    : [...new Set(approval.approvedBy.map(name => name.trim()).filter(Boolean))].sort();

  const status = approval.status || (approvedBy.length > 0 ? 'approved' : 'pending');
  if (!['approved', 'pending', 'rejected'].includes(status)) {
    throw new Error(`Invalid benchmark promotion approval ${source}: status must be approved, pending, or rejected`);
  }

  if (approval.approvedAt !== undefined && typeof approval.approvedAt !== 'string') {
    throw new Error(`Invalid benchmark promotion approval ${source}: approvedAt must be a string`);
  }
  if (approval.ticket !== undefined && typeof approval.ticket !== 'string') {
    throw new Error(`Invalid benchmark promotion approval ${source}: ticket must be a string`);
  }
  if (approval.runId !== undefined && (typeof approval.runId !== 'string' || approval.runId.trim() === '')) {
    throw new Error(`Invalid benchmark promotion approval ${source}: runId must be a non-empty string`);
  }

  const externalReview = validateBenchmarkExternalReview(approval.externalReview, source);

  return {
    status,
    ...(approval.runId !== undefined ? { runId: approval.runId } : {}),
    approvedBy,
    approvedAt: approval.approvedAt || null,
    ticket: approval.ticket || null,
    ...(externalReview ? { externalReview } : {}),
    source
  };
}

function benchmarkPromotionApprovalFromOptions(options = {}) {
  const verifyApproval = approval => {
    if (!approval || !options.verifyExternalReview) return approval;
    const verification = verifyBenchmarkExternalReview(approval.externalReview, options);
    if (!verification) return approval;
    return {
      ...approval,
      externalReview: {
        ...approval.externalReview,
        status: verification.status || approval.externalReview.status,
        verification
      }
    };
  };

  if (options.promotionApproval !== undefined) {
    return verifyApproval(validateBenchmarkPromotionApproval(options.promotionApproval, 'options.promotionApproval'));
  }
  if (!options.approvalFile) return null;
  return verifyApproval(validateBenchmarkPromotionApproval(readJson(path.resolve(options.approvalFile)), options.approvalFile));
}

function benchmarkApproval(options = {}) {
  if (typeof options.runId !== 'string' || options.runId.trim() === '') {
    throw new Error('benchmark approve requires a run id');
  }
  const status = options.status || 'approved';
  const approvedAt = options.approvedAt || (status === 'approved' ? (options.now || new Date()).toISOString() : undefined);
  const approval = validateBenchmarkPromotionApproval({
    runId: options.runId,
    status,
    approvedBy: options.approvedBy || [],
    approvedAt,
    ticket: options.ticket || undefined,
    externalReview: options.externalReview
  }, 'benchmark approve');

  if (approval.status === 'approved' && approval.approvedBy.length === 0) {
    throw new Error('benchmark approve requires at least one --by approver');
  }

  if (options.output) {
    const outputPath = path.resolve(options.cwd || process.cwd(), options.output);
    const { source, ...approvalFile } = approval;
    writeJsonFile(outputPath, approvalFile);
    return { ...approval, output: outputPath };
  }

  return approval;
}

module.exports = {
  benchmarkApproval,
  benchmarkPromotionApprovalFromOptions,
  fetchExternalReviewJson,
  jiraApprovedStatuses,
  parseAzureDevOpsExternalReviewTarget,
  parseGitHubExternalReviewTarget,
  parseJiraExternalReviewTarget,
  safeDecodeURIComponent,
  safeUrlOrigin,
  validateBenchmarkExternalReview,
  validateBenchmarkPromotionApproval,
  verifyAzureDevOpsExternalReview,
  verifyBenchmarkExternalReview,
  verifyGitHubExternalReview,
  verifyJiraExternalReview
};
