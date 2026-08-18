const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const collectorRelease = require('./collector-release');
const { hashText } = require('./hash');
const { collectorHome } = require('./paths');

const defaultCollectorVersion = collectorRelease.defaultCollectorVersion();

function installedCollectorBinaryPath(platform = process.platform) {
  return path.join(collectorHome, 'bin', platform === 'win32' ? 'otelcol-contrib.exe' : 'otelcol-contrib');
}

function collectorPackageInfo({ version = defaultCollectorVersion, platform = process.platform, arch = process.arch } = {}) {
  const normalizedVersion = String(version || defaultCollectorVersion).replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(normalizedVersion)) {
    throw new Error(`Collector version must look like 0.151.0, got: ${version}`);
  }

  const osMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const goos = osMap[platform];
  const goarch = archMap[arch];
  if (!goos || !goarch) {
    throw new Error(`Unsupported Collector binary platform: ${platform}/${arch}`);
  }

  const fileName = `otelcol-contrib_${normalizedVersion}_${goos}_${goarch}.tar.gz`;
  const checksumFileName = goos === 'windows'
    ? 'opentelemetry-collector-releases_otelcol-contrib_windows_checksums.txt'
    : 'opentelemetry-collector-releases_otelcol-contrib_checksums.txt';
  const releaseBaseUrl = `https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${normalizedVersion}`;
  return {
    version: normalizedVersion,
    goos,
    goarch,
    fileName,
    checksumFileName,
    binaryName: goos === 'windows' ? 'otelcol-contrib.exe' : 'otelcol-contrib',
    url: `${releaseBaseUrl}/${fileName}`,
    checksumUrl: `${releaseBaseUrl}/${checksumFileName}`
  };
}

function downloadFile(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error(`Too many redirects while downloading ${url}`));
    const request = https.get(url, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const location = response.headers.location;
        if (!location) return reject(new Error(`Redirect from ${url} did not include a Location header.`));
        return resolve(downloadFile(new URL(location, url).toString(), destination, redirectCount + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download failed (${response.statusCode}) from ${url}`));
      }
      const file = fs.createWriteStream(destination, { mode: 0o600 });
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
      return null;
    });
    request.on('error', reject);
    return request;
  });
}

function parseChecksumFile(text, fileName) {
  const escaped = String(fileName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^([a-fA-F0-9]{64})\\s+\\*?${escaped}$`, 'm');
  const match = String(text || '').match(pattern);
  return match ? match[1].toLowerCase() : null;
}

function sha256File(filePath) {
  return hashText(fs.readFileSync(filePath));
}

function verifyChecksum({ archive, checksumsText, fileName }) {
  const expected = parseChecksumFile(checksumsText, fileName);
  if (!expected) {
    return { ok: false, fileName, error: `No SHA256 checksum found for ${fileName}.` };
  }
  const actual = sha256File(archive);
  return {
    ok: actual === expected,
    fileName,
    expected,
    actual,
    error: actual === expected ? null : `SHA256 mismatch for ${fileName}.`
  };
}

module.exports = {
  collectorPackageInfo,
  defaultCollectorVersion,
  downloadFile,
  installedCollectorBinaryPath,
  parseChecksumFile,
  sha256File,
  verifyChecksum
};
