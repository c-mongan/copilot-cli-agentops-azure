const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { ciStatusFromChecks } = require('./actions-mapper');
const { rowFromPullRequest, stableHash } = require('./pr-mapper');

function parseJson(text, fallback) {
  try {
    return JSON.parse(text || '');
  } catch {
    return fallback;
  }
}

function runGh(args, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const result = spawnSync('gh', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) return { ok: false, error: result.error.message, value: null };
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || `gh exited ${result.status}`).trim(), value: null };
  }
  return { ok: true, error: null, value: result.stdout };
}

function readJsonl(filePath) {
  if (!filePath) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function runMapFromRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!row?.RunId || !row.BranchHash) continue;
    const key = `${row.RepoHash || ''}:${row.BranchHash}`;
    const existing = map.get(key);
    if (!existing || String(row.TimeGenerated || '') > String(existing.TimeGenerated || '')) map.set(key, row);
  }
  return map;
}

function matchingRunForPullRequest(pr, repo, runMap) {
  if (!runMap || runMap.size === 0) return null;
  const repoHash = stableHash(repo, 'repo');
  const branchHash = stableHash(pr.headRefName || pr.headRef?.name || 'unknown-branch', 'branch');
  return runMap.get(`${repoHash}:${branchHash}`) || runMap.get(`:${branchHash}`) || null;
}

function enrichGithubOutcomes(options = {}) {
  const repoResult = runGh(['repo', 'view', '--json', 'nameWithOwner'], options);
  const repo = repoResult.ok ? parseJson(repoResult.value, {})?.nameWithOwner : 'unknown-repo';
  const runMap = runMapFromRows(options.runRows || readJsonl(options.runsFile));
  const limit = String(options.limit || 30);
  const prResult = runGh([
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    limit,
    '--json',
    'number,title,state,createdAt,updatedAt,mergedAt,closedAt,headRefName,changedFiles,commits,reviewDecision,labels,statusCheckRollup'
  ], options);
  if (!prResult.ok) return { ok: false, error: prResult.error, rows: [], table_counts: { AgentOpsGithubOutcomes_CL: 0 } };

  const prs = parseJson(prResult.value, []);
  const rows = (Array.isArray(prs) ? prs : []).map(pr => {
    const run = matchingRunForPullRequest(pr, repo, runMap);
    return rowFromPullRequest(pr, {
      ...options,
      repo,
      runId: run?.RunId,
      run
    });
  });
  return {
    ok: true,
    rows,
    table_counts: { AgentOpsGithubOutcomes_CL: rows.length },
    repo_hash: stableHash(repo, 'repo'),
    matched_runs: rows.filter(row => row.RunId && !String(row.RunId).startsWith('run_')).length
  };
}

function writeGithubOutcomes(rows, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'AgentOpsGithubOutcomes_CL.jsonl');
  fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`);
  const manifest = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifest, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    table_counts: { AgentOpsGithubOutcomes_CL: rows.length },
    files: { AgentOpsGithubOutcomes_CL: file }
  }, null, 2)}\n`);
  return { out_dir: outDir, manifest, file };
}

module.exports = {
  ciStatusFromChecks,
  enrichGithubOutcomes,
  matchingRunForPullRequest,
  rowFromPullRequest,
  runMapFromRows,
  stableHash,
  writeGithubOutcomes
};
