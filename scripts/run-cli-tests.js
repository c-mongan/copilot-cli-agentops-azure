#!/usr/bin/env node
'use strict';

// Runs the agentops-cli suite hermetically: a throwaway HOME, npm cache and
// Azure config dirs, plus failing az/azd/copilot stubs first on PATH. The run
// fails if any test reaches a stub or writes Azure/Copilot/AgentOps state into
// the sandboxed HOME, because the same test would touch the real machine when
// run with a plain `node --test`.

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STUBBED_COMMANDS = Object.freeze(['az', 'azd', 'copilot', 'gh']);
// Inherited location, exporter, cloud-target and integration credentials take
// precedence over HOME in the code under test, so a developer's real settings
// would bypass the sandbox or reach real services.
const STRIPPED_ENV_PATTERN = /^(AGENTOPS_|COPILOT_|OTEL_|JIRA_|APPLICATIONINSIGHTS_|AZURE_|GRAFANA_|LOG_ANALYTICS_)/i;
const STUB_LOG_ENV = 'CLI_TEST_STUB_LOG';
const GUARDED_HOME_PATHS = Object.freeze([
  '.agentops',
  '.azd',
  '.azure',
  '.copilot',
  path.join('Library', 'Caches', 'copilot')
]);

function pathKey(env, platform = process.platform) {
  if (platform !== 'win32') return 'PATH';
  return Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'Path';
}

function prependPath(env, dir, platform = process.platform) {
  const key = pathKey(env, platform);
  const current = env[key] || '';
  return { ...env, [key]: current ? `${dir}${path.delimiter}${current}` : dir };
}

// Stub text must not mention the product name: the Copilot resolver skips
// candidates whose contents look like a product shim and would then fall
// through to the real Copilot CLI further down PATH.
function writeCliStubs(dir, options = {}) {
  const log = options.log !== false;
  const platform = options.platform || process.platform;
  fs.mkdirSync(dir, { recursive: true });
  for (const name of options.commands || STUBBED_COMMANDS) {
    const message = `${name} is stubbed for hermetic tests; inject a runner instead.`;
    if (platform === 'win32') {
      const lines = ['@echo off'];
      // Redirect first so a trailing digit argument is not read as a handle.
      if (log) lines.push(`if defined ${STUB_LOG_ENV} >>"%${STUB_LOG_ENV}%" echo ${name} %*`);
      lines.push(`echo ${message} 1>&2`, 'exit /b 1', '');
      fs.writeFileSync(path.join(dir, `${name}.cmd`), lines.join('\r\n'));
    } else {
      const lines = ['#!/bin/sh'];
      if (log) lines.push(`[ -n "$${STUB_LOG_ENV}" ] && printf '%s %s\\n' '${name}' "$*" >> "$${STUB_LOG_ENV}"`);
      lines.push(`echo '${message}' >&2`, 'exit 1', '');
      const file = path.join(dir, name);
      fs.writeFileSync(file, lines.join('\n'));
      fs.chmodSync(file, 0o755);
    }
  }
  return dir;
}

function createSandbox(options = {}) {
  const root = fs.mkdtempSync(path.join(options.baseDir || os.tmpdir(), 'cli-test-sandbox-'));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'stub-invocations.log');
  fs.mkdirSync(home, { recursive: true });
  writeCliStubs(bin, { platform: options.platform });
  return { root, home, bin, log };
}

// On Windows, spawnSync('gh') without a shell resolves only .exe/.com files, so
// the .cmd stubs cannot intercept it. Drop PATH entries that hold a real
// stubbed CLI. The Node directory survives only when its stubbed CLIs are
// shell-resolved shims (.cmd/.bat/.ps1), which the prepended stubs shadow;
// otherwise Node gets a dedicated sandbox directory instead.
const SHELL_ONLY_EXTENSIONS = Object.freeze(['.cmd', '.bat', '.ps1']);
const DIRECT_EXTENSIONS = Object.freeze(['.exe', '.com', '']);

function stubbedCliIn(entry, extensions, exists) {
  return STUBBED_COMMANDS.some(name => extensions.some(ext => exists(path.win32.join(entry, `${name}${ext}`))));
}

function withoutRealCliDirs(env, platform = process.platform, exists = fs.existsSync) {
  if (platform !== 'win32') return env;
  const key = pathKey(env, platform);
  const entries = String(env[key] || '').split(';').filter(Boolean);
  const kept = entries.filter(entry => {
    if (stubbedCliIn(entry, DIRECT_EXTENSIONS, exists)) return false;
    if (exists(path.win32.join(entry, 'node.exe'))) return true;
    return !stubbedCliIn(entry, SHELL_ONLY_EXTENSIONS, exists);
  });
  return { ...env, [key]: kept.join(';') };
}

function linkNodeExecutable(execPath, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(execPath));
  if (fs.existsSync(target)) return;
  try {
    fs.linkSync(execPath, target);
  } catch {
    fs.copyFileSync(execPath, target);
  }
}

function hermeticEnv(sandbox, baseEnv = process.env, platform = process.platform, options = {}) {
  const { exists = fs.existsSync, execPath = process.execPath, linkNode = linkNodeExecutable } = options;
  let env = withoutRealCliDirs(
    Object.fromEntries(Object.entries(baseEnv).filter(([key]) => !STRIPPED_ENV_PATTERN.test(key))),
    platform,
    exists
  );
  if (platform === 'win32') {
    const nodeDir = path.win32.dirname(execPath).toLowerCase();
    const keptDirs = String(env[pathKey(env, platform)] || '').split(';').map(entry => entry.replace(/[\\/]+$/, '').toLowerCase());
    if (!keptDirs.includes(nodeDir)) {
      const nodeBin = path.join(sandbox.root, 'node-bin');
      linkNode(execPath, nodeBin);
      env = prependPath(env, nodeBin, platform);
    }
  }
  Object.assign(env, {
    HOME: sandbox.home,
    USERPROFILE: sandbox.home,
    XDG_CONFIG_HOME: path.join(sandbox.home, '.config'),
    XDG_CACHE_HOME: path.join(sandbox.home, '.cache'),
    XDG_DATA_HOME: path.join(sandbox.home, '.local', 'share'),
    XDG_STATE_HOME: path.join(sandbox.home, '.local', 'state'),
    AZURE_CONFIG_DIR: path.join(sandbox.root, 'azure-config'),
    AZD_CONFIG_DIR: path.join(sandbox.root, 'azd-config'),
    npm_config_cache: path.join(sandbox.root, 'npm-cache'),
    npm_config_update_notifier: 'false',
    [STUB_LOG_ENV]: sandbox.log
  });
  return prependPath(env, sandbox.bin, platform);
}

function sideEffects(sandbox) {
  const invocations = fs.existsSync(sandbox.log)
    ? fs.readFileSync(sandbox.log, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : [];
  const homeWrites = GUARDED_HOME_PATHS.filter(relative => fs.existsSync(path.join(sandbox.home, relative)));
  return { invocations, homeWrites };
}

function main(args = process.argv.slice(2)) {
  const sandbox = createSandbox();
  let status = 1;
  try {
    const result = childProcess.spawnSync(process.execPath, ['--test', ...args], {
      cwd: process.cwd(),
      env: hermeticEnv(sandbox),
      stdio: 'inherit'
    });
    if (result.error) process.stderr.write(`CLI test runner could not start: ${result.error.message}\n`);
    status = result.status ?? 1;

    const { invocations, homeWrites } = sideEffects(sandbox);
    if (invocations.length > 0) {
      process.stderr.write(`\nHermetic test guard: tests executed stubbed external CLIs (${STUBBED_COMMANDS.join(', ')}).\n`);
      process.stderr.write('Inject a spawnSync/runner stub or put a test-local stub first on PATH:\n');
      for (const line of invocations) process.stderr.write(`  ${line}\n`);
      status = status || 1;
    }
    if (homeWrites.length > 0) {
      process.stderr.write('\nHermetic test guard: tests wrote user state into HOME. Use temp dirs or AGENTOPS_* path overrides:\n');
      for (const relative of homeWrites) process.stderr.write(`  ~/${relative.replaceAll('\\', '/')}\n`);
      status = status || 1;
    }
  } finally {
    if (process.env.CLI_TEST_KEEP_SANDBOX) process.stderr.write(`Kept test sandbox: ${sandbox.root}\n`);
    else fs.rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  return status;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  GUARDED_HOME_PATHS,
  STRIPPED_ENV_PATTERN,
  STUBBED_COMMANDS,
  STUB_LOG_ENV,
  createSandbox,
  hermeticEnv,
  prependPath,
  sideEffects,
  withoutRealCliDirs,
  writeCliStubs
};
