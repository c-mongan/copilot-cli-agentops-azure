const fs = require('node:fs');
const path = require('node:path');

const { repoRoot } = require('./paths');

const releaseCadencePath = path.join(repoRoot, 'collector', 'release-cadence.json');

function readCollectorRelease(filePath = releaseCadencePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function defaultCollectorVersion() {
  return readCollectorRelease().version;
}

function collectorImage() {
  const release = readCollectorRelease();
  return `${release.image}:${release.version}`;
}

function fileIncludes(root, relativePath, value) {
  const fullPath = path.join(root, relativePath);
  return fs.existsSync(fullPath) && fs.readFileSync(fullPath, 'utf8').includes(value);
}

function collectorReleaseContract(root = repoRoot) {
  const manifestPath = path.join(root, 'collector', 'release-cadence.json');
  const release = readCollectorRelease(manifestPath);
  const version = release.version;
  const image = `${release.image}:${version}`;
  const required = [
    ['collector/docker-compose.yaml', image],
    ['collector/docker-compose.azuremonitor.yaml', image],
    ['install-agentops.sh', version],
    ['install-agentops.ps1', version],
    ['docs/collector-modes.md', version]
  ];
  const missing = [];

  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) {
    missing.push('collector/release-cadence.json: version must look like 0.151.0');
  }
  if (!release.review_after) missing.push('collector/release-cadence.json: review_after');
  if (!release.release_notes) missing.push('collector/release-cadence.json: release_notes');
  if (!Array.isArray(release.upgrade_gate) || release.upgrade_gate.length === 0) {
    missing.push('collector/release-cadence.json: upgrade_gate');
  }
  for (const [relativePath, value] of required) {
    if (!fileIncludes(root, relativePath, value)) missing.push(`${relativePath}: ${value}`);
  }

  return {
    ok: missing.length === 0,
    version,
    image,
    review_after: release.review_after,
    cadence: release.cadence,
    evidence: ['collector/release-cadence.json', ...required.map(([relativePath]) => relativePath)],
    missing
  };
}

module.exports = {
  collectorImage,
  collectorReleaseContract,
  defaultCollectorVersion,
  readCollectorRelease,
  releaseCadencePath
};
