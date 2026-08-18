const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  benchmarkFixtureFiles,
  benchmarkFixturePack,
  validateBenchmarkFixtureSealPack,
  validateBenchmarkFixtureTrustRevocations,
  validateBenchmarkFixtureTrustRoots
} = require('../src/lib/benchmark-fixtures');

test('benchmark fixture helpers seal, sign, and validate trusted fixture packs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-bench-fixtures-'));
  const suiteDir = path.join(tempDir, 'suite');
  const fixtureDir = path.join(suiteDir, 'fixtures', 'tiny-repo');
  const keyPath = path.join(suiteDir, 'keys', 'fixture-signing-key.pem');

  try {
    fs.mkdirSync(path.join(fixtureDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'README.md'), '# Fixture\r\n');
    fs.writeFileSync(path.join(fixtureDir, 'docs', 'note.txt'), 'hello\n');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));

    const pack = benchmarkFixturePack({
      cwd: suiteDir,
      fixtureDir: 'fixtures/tiny-repo',
      id: 'tiny-repo-sealed',
      fixture: 'fixtures/tiny-repo',
      signKeyId: 'eval-fixtures-v1',
      signPrivateKey: 'keys/fixture-signing-key.pem'
    });
    const trustRoots = validateBenchmarkFixtureTrustRoots([{
      keyId: 'eval-fixtures-v1',
      publicKey: publicKey.export({ type: 'spki', format: 'pem' })
    }], 'test suite');
    const trustRevocations = validateBenchmarkFixtureTrustRevocations([], 'test suite');

    assert.deepEqual(benchmarkFixtureFiles(fixtureDir), ['README.md', 'docs/note.txt']);
    assert.equal(pack.files['README.md'], crypto.createHash('sha256').update('# Fixture\n').digest('hex'));
    assert.deepEqual(
      validateBenchmarkFixtureSealPack(pack, fixtureDir, 'test pack', {
        fixtureTrustRoots: trustRoots,
        fixtureTrustRevocations: trustRevocations
      }).signature,
      {
        algorithm: 'ed25519',
        keyId: 'eval-fixtures-v1',
        trusted: true
      }
    );

    assert.throws(() => {
      validateBenchmarkFixtureSealPack({ ...pack, title: 'Tampered pack' }, fixtureDir, 'test pack', {
        fixtureTrustRoots: trustRoots,
        fixtureTrustRevocations: trustRevocations
      });
    }, /signature verification failed/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
