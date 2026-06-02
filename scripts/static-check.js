#!/usr/bin/env node

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const skipDirs = new Set([
  '.agentops',
  '.azure',
  '.git',
  'node_modules'
]);
const generatedOrBinaryExts = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.svg'
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function commandExists(command) {
  const result = childProcess.spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore']
  });
  return result.status === 0;
}

function checkJsSyntax(files) {
  const failures = [];
  for (const file of files.filter(item => ['.js', '.cjs', '.mjs'].includes(path.extname(item)))) {
    const result = childProcess.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push({
        file: relative(file),
        error: (result.stderr || result.stdout || `node --check exited ${result.status}`).trim()
      });
    }
  }
  return failures;
}

function checkJson(files) {
  const failures = [];
  for (const file of files.filter(item => path.extname(item) === '.json')) {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      failures.push({ file: relative(file), error: error.message });
    }
  }
  return failures;
}

function isShellScript(file) {
  if (path.extname(file) === '.sh') return true;
  const firstLine = fs.readFileSync(file, 'utf8').split(/\r?\n/, 1)[0] || '';
  return /^#!.*\b(?:ba|z|k)?sh\b/.test(firstLine);
}

function checkShellSyntax(files) {
  if (!commandExists('bash')) return { skipped: true, failures: [] };
  const failures = [];
  for (const file of files.filter(isShellScript)) {
    const result = childProcess.spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push({
        file: relative(file),
        error: (result.stderr || result.stdout || `bash -n exited ${result.status}`).trim()
      });
    }
  }
  return { skipped: false, failures };
}

function stripCodeFences(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

function markdownLinks(markdown) {
  const links = [];
  const text = stripCodeFences(markdown);
  const pattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

function normalizeMarkdownTarget(rawTarget) {
  const target = rawTarget.split(/\s+/, 1)[0].replace(/^<|>$/g, '');
  if (
    !target ||
    target.startsWith('#') ||
    /^(?:https?|mailto|file):/i.test(target)
  ) {
    return null;
  }
  return decodeURIComponent(target.split('#', 1)[0]);
}

function checkMarkdownLinks(files) {
  const failures = [];
  for (const file of files.filter(item => path.extname(item) === '.md')) {
    const dir = path.dirname(file);
    for (const rawTarget of markdownLinks(fs.readFileSync(file, 'utf8'))) {
      const normalized = normalizeMarkdownTarget(rawTarget);
      if (!normalized) continue;
      const targetPath = path.resolve(dir, normalized);
      if (!targetPath.startsWith(repoRoot) || !fs.existsSync(targetPath)) {
        failures.push({
          file: relative(file),
          target: rawTarget,
          error: `missing local markdown link target: ${rawTarget}`
        });
      }
    }
  }
  return failures;
}

function checkTextFiles(files) {
  if (process.platform === 'win32') return [];
  const failures = [];
  for (const file of files) {
    if (generatedOrBinaryExts.has(path.extname(file))) continue;
    const body = fs.readFileSync(file, 'utf8');
    if (body.includes('\r\n')) failures.push({ file: relative(file), error: 'contains CRLF line endings' });
  }
  return failures;
}

function main() {
  const files = walk(repoRoot);
  const shell = checkShellSyntax(files);
  const results = {
    js: checkJsSyntax(files),
    json: checkJson(files),
    shell: shell.failures,
    markdown: checkMarkdownLinks(files),
    text: checkTextFiles(files)
  };
  const failures = Object.values(results).flat();
  const summary = {
    ok: failures.length === 0,
    checked: {
      files: files.length,
      js: files.filter(item => ['.js', '.cjs', '.mjs'].includes(path.extname(item))).length,
      json: files.filter(item => path.extname(item) === '.json').length,
      markdown: files.filter(item => path.extname(item) === '.md').length,
      shell: shell.skipped ? 'skipped' : files.filter(isShellScript).length
    },
    failures
  };

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else if (summary.ok) {
    process.stdout.write(`Static check passed: ${summary.checked.files} files checked.\n`);
  } else {
    process.stderr.write(`Static check failed: ${failures.length} issue(s).\n`);
    for (const failure of failures) {
      process.stderr.write(`- ${failure.file}: ${failure.error}\n`);
    }
  }

  process.exitCode = summary.ok ? 0 : 1;
}

main();
