const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { gitRoot, readOwnedAttachment } = require('../attach-command');
const { architectureVersion } = require('../architecture/graph');
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function boundedAttachment(root) {
  try {
    for (const name of ['attachment.json', '.attachment-receipt.json']) {
      const stat = fs.lstatSync(path.join(root, '.agentops', name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ATTACHMENT_BYTES) return { ok: false };
    }
    return readOwnedAttachment(root);
  } catch { return { ok: false }; }
}
function metadataArchitecture(input = {}) {
  let count = 0;
  const row = value => {
    if (++count > 10000) throw new Error('attachment component limit exceeded');
    if (typeof value.path !== 'string' || value.path.length > 1024 || (path.isAbsolute(value.path) || path.win32.isAbsolute(value.path))
      || value.path.split(/[\\/]/).includes('..') || /[\x00-\x1f]/.test(value.path)
      || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('invalid attachment component metadata');
    const output = { path: value.path, sha256: value.sha256 };
    if (typeof value.name === 'string' && /^[A-Za-z0-9_.:/@+-]{1,200}$/.test(value.name)) output.name = value.name;
    return output;
  };
  return {
    agents: (input.agents || []).map(row),
    skills: (input.skills || []).map(skill => ({ ...row(skill), references: (skill.references || []).map(row), scripts: (skill.scripts || []).map(row) })),
    runtimeScripts: (input.runtimeScripts || []).map(row)
  };
}
function snapshotHash(value) { const { sha256, ...body } = value; return hash(JSON.stringify(body)); }
function capturePreRunSnapshot({ cwd, executionConfiguration, taskId = null } = {}) {
  let root;
  try { root = gitRoot(cwd); } catch { root = fs.realpathSync(cwd); }
  const base = { schemaVersion: 1, status: 'unavailable', capturedAt: new Date().toISOString(),
    repositoryRootHash: hash(root).slice(0, 16), attachmentManifestSha256: null, architectureVersion: null,
    architecture: null, configurationVersion: executionConfiguration?.configurationVersion || null,
    taskId: typeof taskId === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(taskId) ? taskId : null };
  const owned = boundedAttachment(root);
  try {
    if (owned.ok) {
      base.architecture = metadataArchitecture(owned.manifest.architecture);
      base.architectureVersion = architectureVersion(base.architecture);
      base.attachmentManifestSha256 = owned.receipt.manifestSha256;
      base.status = 'captured';
    }
  } catch { base.architecture = null; base.architectureVersion = null; }
  return freeze({ ...base, sha256: snapshotHash(base) });
}
function validPreRunSnapshot(snapshot) {
  try {
    return snapshot?.schemaVersion === 1 && snapshot.status === 'captured'
      && Object.keys(snapshot).sort().join(',') === ['schemaVersion','status','capturedAt','repositoryRootHash','attachmentManifestSha256','architectureVersion','architecture','configurationVersion','taskId','sha256'].sort().join(',')
      && JSON.stringify(snapshot.architecture) === JSON.stringify(metadataArchitecture(snapshot.architecture))
      && /^[a-f0-9]{64}$/.test(snapshot.attachmentManifestSha256)
      && snapshot.sha256 === snapshotHash(snapshot)
      && snapshot.architectureVersion === architectureVersion(metadataArchitecture(snapshot.architecture));
  } catch { return false; }
}
function attachmentProvenance(snapshot, root) {
  const after = boundedAttachment(root);
  const postRunSha256 = after.ok ? after.receipt.manifestSha256 : null;
  return { status: !validPreRunSnapshot(snapshot) ? 'not-captured' : !postRunSha256 ? 'unavailable'
    : snapshot.attachmentManifestSha256 === postRunSha256 ? 'unchanged' : 'changed',
  preRunSha256: validPreRunSnapshot(snapshot) ? snapshot.attachmentManifestSha256 : null, postRunSha256 };
}
function sessionSourceIntegrity(file, sessionId) {
  const unknown = { status: 'unknown', rowCount: 0, malformedRows: 0, sessionStartCount: 0, sessionTerminalCount: 0 };
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) return { ...unknown, status: 'invalid', reason: 'unsafe or oversized source' };
    const bytes = fs.readFileSync(file);
    if (bytes.length > 32 * 1024 * 1024) return { ...unknown, status: 'invalid', reason: 'oversized source' };
    const rows = [], starts = new Map(), terminals = new Map(); let malformedRows = 0, badToolOrder = false;
    for (const line of bytes.toString('utf8').split(/\r?\n/).filter(Boolean)) {
      try { const row = JSON.parse(line); if (!row || typeof row.type !== 'string' || !row.data || typeof row.data !== 'object') malformedRows++; else rows.push(row); } catch { malformedRows++; }
    }
    const sessionStarts = rows.filter(row => row.type === 'session.start');
    const ends = rows.filter(row => row.type === 'session.shutdown');
    for (const row of rows) {
      const id = row.data.toolCallId;
      if (id && row.type === 'tool.execution_start') starts.set(id, (starts.get(id) || 0) + 1);
      if (row.type.startsWith('tool.execution_') && (typeof id !== 'string' || !id)) badToolOrder = true;
      if (id && row.type === 'tool.execution_complete') {
        if (!starts.has(id)) badToolOrder = true;
        terminals.set(id, (terminals.get(id) || 0) + 1);
      }
    }
    const pendingTools = [...starts.keys()].filter(id => !terminals.has(id)).length;
    const invalid = rows.some(row => row.data.sessionId !== undefined && row.data.sessionId !== sessionId)
      || badToolOrder || malformedRows > 0 || sessionStarts.length !== 1 || sessionStarts[0]?.data.sessionId !== sessionId
      || rows[0]?.type !== 'session.start' || ends.length > 1
      || (ends.length === 1 && rows.at(-1)?.type !== 'session.shutdown')
      || [...starts.values(), ...terminals.values()].some(n => n !== 1)
      || [...terminals.keys()].some(id => !starts.has(id));
    return { status: invalid ? 'invalid' : ends.length === 1 && pendingTools === 0 ? 'valid' : 'partial',
      rowCount: rows.length, malformedRows, sessionStartCount: sessionStarts.length, sessionTerminalCount: ends.length,
      toolStarts: starts.size, toolTerminals: terminals.size, pendingTools,
      sha256: hash(bytes), scope: 'selected-session-event-file', terminalType: 'session.shutdown' };
  } catch { return unknown; }
}
module.exports = { capturePreRunSnapshot, validPreRunSnapshot, attachmentProvenance, sessionSourceIntegrity };
