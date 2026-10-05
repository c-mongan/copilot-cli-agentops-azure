'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../..');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
function rng(seed) {
  if (typeof seed !== 'string' || !seed.length || seed.length > 256) throw new Error('seed must be a nonempty string, at most 256 characters');
  let state = parseInt(hash(seed).slice(0, 8), 16);
  return () => { state += 0x6D2B79F5; let x = state; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}
function knownOpaque(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value) && !/^(?:unknown|partial|unavailable|missing|unresolved|unset|none|null|n-a)(?:$|[:._-])/i.test(value);
}
function shuffle(values, random) { const rows = [...values]; for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; } return rows; }
function inside(file, root) { return file === root || file.startsWith(root + path.sep); }
function readJson(file, limit = 8 * 1024 * 1024) {
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('invalid or oversized JSON file');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function preparePaths(publicDir, keyFile) {
  publicDir = path.resolve(publicDir); keyFile = path.resolve(keyFile);
  if (fs.existsSync(publicDir) || fs.existsSync(keyFile)) throw new Error('output paths must be new');
  const keyParent = fs.realpathSync(path.dirname(keyFile));
  const publicParent = fs.realpathSync(path.dirname(publicDir));
  const publicReal = path.join(publicParent, path.basename(publicDir));
  const keyReal = path.join(keyParent, path.basename(keyFile));
  if (inside(keyReal, repo) || inside(keyReal, publicReal) || inside(publicReal, keyParent)) throw new Error('answer key must be outside repository and public/staged workspace trees');
  return { publicDir: publicReal, keyFile: keyReal };
}
function writeJson(file, value, mode = 0o644) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode }); }
function readKey(file) { const value = readJson(file); if ((fs.statSync(file).mode & 0o077) !== 0) throw new Error('answer key must have mode 0600'); return value; }
module.exports = { hash, rng, shuffle, knownOpaque, inside, readJson, preparePaths, writeJson, readKey, repo };
