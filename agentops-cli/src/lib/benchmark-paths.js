const fs = require('node:fs');
const path = require('node:path');

function safeBenchmarkPath(baseDir, relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error(`Benchmark path must be relative: ${relativePath}`);
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Benchmark path cannot leave the workspace: ${relativePath}`);
  }
  return path.resolve(baseDir, normalized);
}

function normalizeBenchmarkRelativePath(relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error(`Benchmark path must be relative: ${relativePath}`);
  const normalized = path.normalize(relativePath).replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Benchmark path cannot leave the workspace: ${relativePath}`);
  }
  return normalized;
}

function benchmarkPathGlobRegExp(pattern) {
  const normalized = normalizeBenchmarkRelativePath(pattern);
  const source = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`);
}

function benchmarkPathPatternMatches(pattern, relativePath) {
  const normalizedPattern = normalizeBenchmarkRelativePath(pattern);
  const normalizedPath = normalizeBenchmarkRelativePath(relativePath);
  if (!/[*?]/.test(normalizedPattern)) return normalizedPattern === normalizedPath;
  return benchmarkPathGlobRegExp(normalizedPattern).test(normalizedPath);
}

function benchmarkForbiddenMatches(forbiddenPatterns, files) {
  const matches = new Set();
  for (const file of files) {
    if (forbiddenPatterns.some(pattern => benchmarkPathPatternMatches(pattern, file))) {
      matches.add(normalizeBenchmarkRelativePath(file));
    }
  }
  return [...matches].sort();
}

function relativeFileSnapshot(dir, options = {}) {
  const snapshot = new Map();
  if (!fs.existsSync(dir)) return snapshot;

  const walk = options.walk;
  const hashText = options.hashText;
  if (typeof walk !== 'function') throw new Error('relativeFileSnapshot requires options.walk');
  if (typeof hashText !== 'function') throw new Error('relativeFileSnapshot requires options.hashText');

  for (const file of walk(dir, item => fs.statSync(item).isFile())) {
    snapshot.set(normalizeBenchmarkRelativePath(path.relative(dir, file)), hashText(fs.readFileSync(file)));
  }

  return snapshot;
}

function changedRelativeFiles(before, after) {
  const files = new Set([...before.keys(), ...after.keys()]);
  return [...files].filter(file => before.get(file) !== after.get(file)).sort();
}

function relativeFileDiff(before, after) {
  const files = new Set([...before.keys(), ...after.keys()]);
  const diff = {
    added: [],
    modified: [],
    deleted: []
  };

  for (const file of files) {
    const beforeHash = before.get(file);
    const afterHash = after.get(file);
    if (beforeHash === afterHash) continue;
    if (beforeHash === undefined) diff.added.push(file);
    else if (afterHash === undefined) diff.deleted.push(file);
    else diff.modified.push(file);
  }

  diff.added.sort();
  diff.modified.sort();
  diff.deleted.sort();
  diff.totalChanged = diff.added.length + diff.modified.length + diff.deleted.length;
  return diff;
}

module.exports = {
  benchmarkForbiddenMatches,
  benchmarkPathGlobRegExp,
  benchmarkPathPatternMatches,
  changedRelativeFiles,
  normalizeBenchmarkRelativePath,
  relativeFileDiff,
  relativeFileSnapshot,
  safeBenchmarkPath
};
