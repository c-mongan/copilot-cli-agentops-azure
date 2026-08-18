const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  collectorPackageInfo,
  parseChecksumFile,
  verifyChecksum
} = require('../src/lib/collector-binary-release');

test('collector binary release helpers map packages and verify checksums', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-collector-release-'));
  try {
    const mac = collectorPackageInfo({ version: 'v0.151.0', platform: 'darwin', arch: 'arm64' });
    const archive = path.join(tempDir, 'otelcol-contrib_0.151.0_darwin_arm64.tar.gz');
    fs.writeFileSync(archive, 'expected archive');
    const hash = crypto.createHash('sha256').update('expected archive').digest('hex');
    const checksums = `${hash}  ${mac.fileName}\n`;

    assert.equal(mac.fileName, 'otelcol-contrib_0.151.0_darwin_arm64.tar.gz');
    assert.equal(mac.binaryName, 'otelcol-contrib');
    assert.match(mac.url, /download\/v0\.151\.0/);
    assert.equal(parseChecksumFile(checksums, mac.fileName), hash);
    assert.equal(verifyChecksum({ archive, checksumsText: checksums, fileName: mac.fileName }).ok, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
