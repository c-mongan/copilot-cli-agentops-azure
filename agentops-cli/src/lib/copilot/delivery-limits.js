const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const defaultDeliveryLimits = Object.freeze({ ttlMs: 48 * 60 * 60 * 1000, maxQueueBytes: 128 * 1024 * 1024, maxPublishBytesPerDay: 0 });
const maxStateBytes = 64 * 1024;

function deliveryLimits(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('delivery limits must be an object');
  const result = { ...defaultDeliveryLimits };
  for (const key of Object.keys(input)) {
    if (!(key in result) || !Number.isSafeInteger(input[key]) || input[key] < (key === 'maxPublishBytesPerDay' ? 0 : 1)) {
      throw new Error(`invalid delivery limit: ${key}`);
    }
    result[key] = input[key];
  }
  if (result.ttlMs > defaultDeliveryLimits.ttlMs || result.maxQueueBytes > defaultDeliveryLimits.maxQueueBytes) {
    throw new Error('delivery expiry and queue limits cannot exceed 48 hours or 128 MiB per queue');
  }
  return result;
}

function readPrivateFile(file, maxBytes) {
  const before = fs.lstatSync(file);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('delivery file must be a regular file without symlinks');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.nlink !== 1 || stat.size > maxBytes
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new Error('delivery file must be a bounded, owner-owned regular file without hard links');
    }
    if (process.platform !== 'win32') fs.fchmodSync(descriptor, 0o600);
    // Read a bounded buffer rather than trusting a size check before readFileSync.
    const buffer = Buffer.alloc(stat.size + 1);
    const count = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    if (count !== stat.size) throw new Error('delivery file changed during bounded read');
    return buffer.subarray(0, count).toString('utf8');
  } finally { fs.closeSync(descriptor); }
}

function deliveryTargetHash(target) {
  if (!target || ['subscriptionId', 'logsIngestionEndpoint', 'dcrImmutableId'].some(key => typeof target[key] !== 'string' || !target[key])) {
    throw new Error('publishing requires a complete target binding');
  }
  const endpoint = new URL(target.logsIngestionEndpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('publishing target must be HTTPS without credentials or query data');
  }
  return crypto.createHash('sha256').update(JSON.stringify([target.subscriptionId, endpoint.href, target.dcrImmutableId])).digest('hex');
}

// The caller holds the shared runs-directory claim through this atomic reservation.
// Charge attempted bytes before sending; ambiguous responses never refund allowance.
function reservePublishBytes(directory, target, bytes, limits, now, writeJson) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || !Number.isSafeInteger(now) || now < 0) throw new Error('invalid publishing reservation');
  const file = path.join(directory, '.session-publish-budget.json');
  const day = new Date(now).toISOString().slice(0, 10);
  const targetHash = deliveryTargetHash(target);
  const policyHash = crypto.createHash('sha256').update(JSON.stringify({ maxPublishBytesPerDay: limits.maxPublishBytesPerDay })).digest('hex');
  let previous;
  try { previous = JSON.parse(readPrivateFile(file, maxStateBytes)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && (previous.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(previous.day)
    || !Number.isFinite(Date.parse(previous.day)) || !/^[a-f0-9]{64}$/.test(previous.targetHash)
    || !/^[a-f0-9]{64}$/.test(previous.policyHash) || !Number.isSafeInteger(previous.reservedUpperBoundBytes) || previous.reservedUpperBoundBytes < 0)) {
    throw new Error('invalid publishing budget schema');
  }
  if (previous && (previous.day > day || previous.targetHash !== targetHash)) throw new Error('publishing budget clock or target binding changed');
  if (previous?.day === day && previous.policyHash !== policyHash) throw new Error('publishing budget policy binding changed');
  const reservedBytes = previous?.day === day ? previous.reservedUpperBoundBytes : 0;
  if (bytes > limits.maxPublishBytesPerDay - reservedBytes) return { allowed: false, reason: 'publishing_ceiling', day, reservedUpperBoundBytes: reservedBytes };
  const state = { version: 1, day, targetHash, policyHash, reservedUpperBoundBytes: reservedBytes + bytes };
  writeJson(file, state);
  return { allowed: true, ...state };
}

function configuredDeliveryLimits(options = {}) {
  const env = options.env || process.env;
  const value = env.AGENTOPS_MAX_PUBLISH_BYTES_PER_DAY;
  const configured = value === undefined ? {} : { maxPublishBytesPerDay: /^\d+$/.test(value) ? Number(value) : NaN };
  return deliveryLimits({ ...configured, ...(options.deliveryLimits || {}) });
}

function reserveSharedPublishBytes(options, target, bytes) {
  const limits = configuredDeliveryLimits(options);
  if (bytes > limits.maxPublishBytesPerDay) return { allowed: false, reason: 'publishing_ceiling' };
  const home = path.resolve(options.agentopsHome || require('../paths').agentopsHome);
  if (fs.existsSync(home)) {
    const stat = fs.lstatSync(home);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('publishing home must be a real owner-owned directory');
  }
  const directory = path.join(home, 'runs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { claimSessionOutbox, releaseSessionOutboxClaim } = require('./session-delivery-outbox');
  const claim = claimSessionOutbox(directory);
  if (!claim.acquired) return { allowed: false, reason: 'publishing_budget_busy' };
  try {
    return reservePublishBytes(directory, target, bytes, limits, Number(typeof options.now === 'function' ? options.now() : (options.now ?? Date.now())), (file, state) => {
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
      const dirFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    });
  } finally { releaseSessionOutboxClaim(claim); }
}

module.exports = { configuredDeliveryLimits, reserveSharedPublishBytes, defaultDeliveryLimits, deliveryLimits, deliveryTargetHash, maxStateBytes, readPrivateFile, reservePublishBytes };
