const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeBenchmarkRelativePath, safeBenchmarkPath } = require('./benchmark-paths');
const { writeJsonFile } = require('./command-output');
const { hashText } = require('./hash');
const { readJson } = require('./json');
const { isPlainObject } = require('./type-predicates');

function displaySourcePath(filePath, root = process.cwd()) {
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return relative.startsWith('../') ? filePath.replace(/\\/g, '/') : relative;
}

function hashBenchmarkFixtureSealFile(filePath) {
  return hashText(fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'));
}

function benchmarkFixtureFiles(fixtureDir) {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(normalizeBenchmarkRelativePath(path.relative(fixtureDir, fullPath)));
      }
    }
  };
  walk(fixtureDir);
  return files.sort();
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (isPlainObject(value)) {
    return Object.keys(value).sort().reduce((object, key) => {
      object[key] = stableJson(value[key]);
      return object;
    }, {});
  }
  return value;
}

function benchmarkFixtureSealPackSigningPayload(pack) {
  const { output, signature, ...payload } = pack;
  return Buffer.from(JSON.stringify(stableJson(payload)));
}

function signBenchmarkFixtureSealPack(pack, options = {}) {
  if (typeof options.signKeyId !== 'string' || options.signKeyId.trim() === '') {
    throw new Error('benchmark fixture-pack requires --sign-key-id when signing');
  }
  if (typeof options.signPrivateKey !== 'string' || options.signPrivateKey.trim() === '') {
    throw new Error('benchmark fixture-pack requires --sign-private-key when signing');
  }

  const cwd = options.cwd || process.cwd();
  const privateKeyPath = path.resolve(cwd, options.signPrivateKey);
  if (!fs.existsSync(privateKeyPath) || !fs.statSync(privateKeyPath).isFile()) {
    throw new Error(`benchmark fixture-pack signing private key does not exist: ${options.signPrivateKey}`);
  }

  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const signature = crypto.sign(null, benchmarkFixtureSealPackSigningPayload(pack), privateKey).toString('base64');
  return {
    algorithm: 'ed25519',
    keyId: options.signKeyId,
    publicKey,
    value: signature
  };
}

function canonicalBenchmarkPublicKey(publicKey, source) {
  try {
    return crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'pem' });
  } catch {
    throw new Error(`Invalid benchmark fixture trust root ${source}: publicKey must be a PEM public key`);
  }
}

function parseBenchmarkTrustRootTime(value, field, source) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid benchmark ${source}: ${field} must be an ISO timestamp`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`Invalid benchmark ${source}: ${field} must be an ISO timestamp`);
  }
  return value;
}

function validateBenchmarkFixtureTrustRoots(trustRoots, source = 'suite') {
  if (trustRoots === undefined) return [];
  if (!Array.isArray(trustRoots)) {
    throw new Error(`Invalid benchmark ${source}: fixtureTrustRoots must be an array`);
  }

  const seen = new Set();
  return trustRoots.map((rootEntry, index) => {
    const errors = [];
    if (!isPlainObject(rootEntry)) {
      throw new Error(`Invalid benchmark ${source}: fixtureTrustRoots[${index}] must be an object`);
    }
    if (typeof rootEntry.keyId !== 'string' || rootEntry.keyId.trim() === '') errors.push('keyId must be a non-empty string');
    if (typeof rootEntry.publicKey !== 'string' || rootEntry.publicKey.trim() === '') errors.push('publicKey must be a PEM public key');
    if (errors.length > 0) {
      throw new Error(`Invalid benchmark ${source}: fixtureTrustRoots[${index}] ${errors.join('; ')}`);
    }
    if (seen.has(rootEntry.keyId)) {
      throw new Error(`Invalid benchmark ${source}: duplicate fixtureTrustRoots keyId: ${rootEntry.keyId}`);
    }
    seen.add(rootEntry.keyId);

    const rootSource = `${source} fixtureTrustRoots[${index}]`;
    const notBefore = parseBenchmarkTrustRootTime(rootEntry.notBefore, `${rootSource}.notBefore`, source);
    const notAfter = parseBenchmarkTrustRootTime(rootEntry.notAfter, `${rootSource}.notAfter`, source);
    if (notBefore && notAfter && Date.parse(notAfter) <= Date.parse(notBefore)) {
      throw new Error(`Invalid benchmark ${source}: ${rootSource}.notAfter must be after notBefore`);
    }
    return {
      keyId: rootEntry.keyId,
      publicKey: canonicalBenchmarkPublicKey(rootEntry.publicKey, rootSource),
      notBefore,
      notAfter
    };
  });
}

function validateBenchmarkFixtureTrustRevocations(revocations, source = 'suite') {
  if (revocations === undefined) return [];
  if (!Array.isArray(revocations)) {
    throw new Error(`Invalid benchmark ${source}: fixtureTrustRevocations must be an array`);
  }

  const seen = new Set();
  return revocations.map((revocation, index) => {
    const keyId = typeof revocation === 'string' ? revocation : revocation && revocation.keyId;
    if (typeof keyId !== 'string' || keyId.trim() === '') {
      throw new Error(`Invalid benchmark ${source}: fixtureTrustRevocations[${index}] keyId must be a non-empty string`);
    }
    if (seen.has(keyId)) {
      throw new Error(`Invalid benchmark ${source}: duplicate fixtureTrustRevocations keyId: ${keyId}`);
    }
    seen.add(keyId);
    return { keyId };
  });
}

function validateBenchmarkFixtureSealPackSignature(pack, source = 'fixture seal pack', trustRoots = [], trustRevocations = []) {
  if (pack.signature === undefined && trustRoots.length > 0) {
    throw new Error(`Invalid benchmark fixture seal pack ${source}: signature required by fixture trust roots`);
  }
  if (pack.signature === undefined) return null;
  if (!isPlainObject(pack.signature)) {
    throw new Error(`Invalid benchmark fixture seal pack ${source}: signature must be an object`);
  }

  const signature = pack.signature;
  const errors = [];
  if (signature.algorithm !== 'ed25519') errors.push('signature.algorithm must be ed25519');
  if (typeof signature.keyId !== 'string' || signature.keyId.trim() === '') errors.push('signature.keyId must be a non-empty string');
  if (typeof signature.publicKey !== 'string' || signature.publicKey.trim() === '') errors.push('signature.publicKey must be a PEM public key');
  if (typeof signature.value !== 'string' || signature.value.trim() === '') errors.push('signature.value must be a base64 signature');
  if (errors.length > 0) {
    throw new Error(`Invalid benchmark fixture seal pack ${source}: ${errors.join('; ')}`);
  }

  let verified = false;
  try {
    verified = crypto.verify(
      null,
      benchmarkFixtureSealPackSigningPayload(pack),
      signature.publicKey,
      Buffer.from(signature.value, 'base64')
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new Error(`Invalid benchmark fixture seal pack ${source}: signature verification failed`);
  }

  if (trustRevocations.some(revocation => revocation.keyId === signature.keyId)) {
    throw new Error(`Invalid benchmark fixture seal pack ${source}: signature keyId is revoked`);
  }

  if (trustRoots.length > 0) {
    const trustedRoot = trustRoots.find(rootEntry => rootEntry.keyId === signature.keyId);
    if (!trustedRoot) {
      throw new Error(`Invalid benchmark fixture seal pack ${source}: signature keyId is not trusted`);
    }
    const now = Date.now();
    if (trustedRoot.notBefore && now < Date.parse(trustedRoot.notBefore)) {
      throw new Error(`Invalid benchmark fixture seal pack ${source}: signature keyId is not active yet`);
    }
    if (trustedRoot.notAfter && now > Date.parse(trustedRoot.notAfter)) {
      throw new Error(`Invalid benchmark fixture seal pack ${source}: signature keyId trust root expired`);
    }
    const signaturePublicKey = canonicalBenchmarkPublicKey(signature.publicKey, `${source} signature`);
    if (signaturePublicKey !== trustedRoot.publicKey) {
      throw new Error(`Invalid benchmark fixture seal pack ${source}: signature public key does not match trust root`);
    }
  }

  return {
    algorithm: signature.algorithm,
    keyId: signature.keyId,
    ...(trustRoots.length > 0 ? { trusted: true } : {})
  };
}

function benchmarkFixturePack(options = {}) {
  const cwd = options.cwd || process.cwd();
  const fixtureDir = path.resolve(cwd, options.fixtureDir);
  if (!fs.existsSync(fixtureDir) || !fs.statSync(fixtureDir).isDirectory()) {
    throw new Error(`benchmark fixture-pack fixture directory does not exist: ${options.fixtureDir}`);
  }

  const files = {};
  for (const file of benchmarkFixtureFiles(fixtureDir)) {
    files[file] = hashBenchmarkFixtureSealFile(path.join(fixtureDir, file));
  }

  if (Object.keys(files).length === 0) {
    throw new Error(`benchmark fixture-pack fixture directory has no files: ${options.fixtureDir}`);
  }

  const pack = {
    id: options.id,
    ...(typeof options.title === 'string' && options.title.trim() !== '' ? { title: options.title } : {}),
    fixture: normalizeBenchmarkRelativePath(options.fixture || path.relative(cwd, fixtureDir) || '.'),
    algorithm: 'sha256',
    files
  };
  if (options.signKeyId || options.signPrivateKey) {
    pack.signature = signBenchmarkFixtureSealPack(pack, { ...options, cwd });
  }

  if (options.output) {
    const outputPath = path.resolve(cwd, options.output);
    writeJsonFile(outputPath, pack);
    return { ...pack, output: outputPath };
  }
  return pack;
}

function validateBenchmarkFixtureSeal(seal, fixturePath, source = 'task') {
  if (seal === undefined) return null;
  if (!isPlainObject(seal)) {
    throw new Error(`Invalid benchmark task ${source}: fixtureSeal must be an object`);
  }

  const algorithm = seal.algorithm || 'sha256';
  if (algorithm !== 'sha256') {
    throw new Error(`Invalid benchmark task ${source}: fixtureSeal algorithm must be sha256`);
  }
  if (!isPlainObject(seal.files) || Object.keys(seal.files).length === 0) {
    throw new Error(`Invalid benchmark task ${source}: fixtureSeal files must be a non-empty object`);
  }

  const files = {};
  for (const [file, expectedHash] of Object.entries(seal.files)) {
    if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
      throw new Error(`Invalid benchmark task ${source}: fixtureSeal hash for ${file} must be a sha256 hex string`);
    }
    const filePath = safeBenchmarkPath(fixturePath, file);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Invalid benchmark task ${source}: sealed fixture file does not exist: ${file}`);
    }
    const actualHash = hashBenchmarkFixtureSealFile(filePath);
    if (actualHash !== expectedHash.toLowerCase()) {
      throw new Error(`Invalid benchmark task ${source}: sealed fixture file changed: ${file}`);
    }
    files[normalizeBenchmarkRelativePath(file)] = expectedHash.toLowerCase();
  }

  return {
    algorithm,
    files
  };
}

function validateBenchmarkFixtureSealPack(pack, fixturePath, source = 'fixture seal pack', options = {}) {
  const errors = [];
  if (!isPlainObject(pack)) {
    throw new Error(`Invalid benchmark fixture seal pack ${source}: must be an object`);
  }
  if (typeof pack.id !== 'string' || pack.id.trim() === '') errors.push('id must be a non-empty string');
  if (typeof pack.fixture !== 'string' || pack.fixture.trim() === '') errors.push('fixture must be a non-empty string');
  if (errors.length > 0) {
    throw new Error(`Invalid benchmark fixture seal pack ${source}: ${errors.join('; ')}`);
  }

  const signature = validateBenchmarkFixtureSealPackSignature(
    pack,
    source,
    options.fixtureTrustRoots || [],
    options.fixtureTrustRevocations || []
  );
  const fixtureSeal = validateBenchmarkFixtureSeal({
    algorithm: pack.algorithm,
    files: pack.files
  }, fixturePath, source);

  return {
    id: pack.id,
    title: typeof pack.title === 'string' && pack.title.trim() !== '' ? pack.title : pack.id,
    fixture: normalizeBenchmarkRelativePath(pack.fixture),
    algorithm: fixtureSeal.algorithm,
    files: fixtureSeal.files,
    signature,
    source
  };
}

function loadBenchmarkFixtureSealPack(task, suiteDir, fixturePath, source = 'task', options = {}) {
  if (task.fixtureSealPack === undefined) return null;
  if (typeof task.fixtureSealPack !== 'string' || task.fixtureSealPack.trim() === '') {
    throw new Error(`Invalid benchmark task ${source}: fixtureSealPack must be a non-empty string`);
  }

  const packPath = task.fixtureSealPack;
  if (path.isAbsolute(packPath) || path.normalize(packPath).startsWith(`..${path.sep}`) || path.normalize(packPath) === '..') {
    throw new Error(`Invalid benchmark task ${source}: fixture seal pack path cannot leave the suite: ${packPath}`);
  }
  const fullPath = path.resolve(suiteDir, packPath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Invalid benchmark task ${source}: fixture seal pack does not exist: ${packPath}`);
  }

  const fixtureSealPack = validateBenchmarkFixtureSealPack(readJson(fullPath), fixturePath, displaySourcePath(fullPath, options.root), options);
  if (fixtureSealPack.fixture !== normalizeBenchmarkRelativePath(task.fixture)) {
    throw new Error(`Invalid benchmark task ${source}: fixtureSealPack fixture must match task fixture`);
  }
  return fixtureSealPack;
}

module.exports = {
  benchmarkFixtureFiles,
  benchmarkFixturePack,
  benchmarkFixtureSealPackSigningPayload,
  loadBenchmarkFixtureSealPack,
  signBenchmarkFixtureSealPack,
  stableJson,
  validateBenchmarkFixtureSeal,
  validateBenchmarkFixtureSealPack,
  validateBenchmarkFixtureSealPackSignature,
  validateBenchmarkFixtureTrustRevocations,
  validateBenchmarkFixtureTrustRoots
};
