#!/usr/bin/env node
'use strict';
// Run only in a disposable Windows x64 runner. No Azure or paid model is used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { prepareNativeCompanionPackage } = require('./package-native-companion');
const { dependencyClosure } = require('./package-native-extension');
const { ensureCollector } = require('../extensions/agentops-native/src/recorder');
const { downloadFile, collectorPackageInfo } = require('../agentops-cli/src/lib/collector-binary-release');
const { freePort } = require('../agentops-cli/src/lib/copilot/scoped-collector');
const { qualify, cleanEnvironment } = require('./qualify-native-cli');
const PINS = Object.freeze({
  copilotVersion: '1.0.91',
  copilotUrl: 'https://registry.npmjs.org/@github/copilot-win32-x64/-/copilot-win32-x64-1.0.91.tgz',
  copilotSha512: 'rbWXlTsObYvn8Xw1XcIlZ9CBMaogivE2FdaLdPQQQ42i/soJd3Em9QKXc8nxML2+GJcnzl3Y0VnlEQKhb81bOw==',
  vscodeVersion: '1.140.0',
  vscodeUrl: 'https://vscode.download.prss.microsoft.com/dbazure/download/stable/07f806f999227108933c2e30515b26eecc1fda74/VSCode-win32-x64-1.140.0.zip',
  vscodeSha256: '52f47072473375767d63ea5be9ffb96a3092124223fe5ce036834a299715014e',
  collectorVersion: '0.151.0'
});
async function verifyDigest(file, algorithm, expected, encoding = 'hex') {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const actual = hash.digest(encoding);
  if (actual !== expected) throw new Error('Pinned download digest differs.');
  return actual;
}
function commandLine(launcher, storage, port) {
  for (const file of [launcher, storage]) if (!path.win32.isAbsolute(file) || /[\r\n\0"%!^&|<>]/.test(file)) throw new Error('Qualification path contains unsupported command characters.');
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Qualification control port is invalid.');
  return `"${launcher}" --no-browser --port ${port} --storage "${storage}"`;
}
function sourceClosure(sourceRoot = path.resolve(__dirname, '..')) {
  const files = new Set(['LICENSE', 'companion/package.json', 'extensions/agentops-native/package.json', 'collector/otelcol.local.strict.yaml', 'collector/release-cadence.json', 'scripts/package-native-extension.js', 'scripts/package-native-companion.js', 'scripts/qualify-native-cli.js', 'scripts/qualify-native-windows.js', 'scripts/run-native-tests.js', 'scripts/test/package-native-companion.test.js', 'scripts/test/qualify-native-cli.test.js', 'scripts/test/qualify-native-windows.test.js']);
  for (const directory of ['companion/src', 'companion/test', 'extensions/agentops-native/src', 'extensions/agentops-native/test']) {
    for (const name of fs.readdirSync(path.join(sourceRoot, directory))) if (name.endsWith('.js')) files.add(path.posix.join(directory, name));
  }
  const library = path.join(sourceRoot, 'agentops-cli/src/lib');
  for (const file of dependencyClosure(library, ['copilot/scoped-collector.js', 'collector-binary-release.js', 'copilot/session-otel.js', 'copilot/session-span-export.js', 'copilot/delivery-limits.js'])) files.add(path.posix.join('agentops-cli/src/lib', path.relative(library, file).split(path.sep).join('/')));
  return [...files].sort();
}
function nativeProof(report) {
  const capture = report.code === 0 && report.hasAgent && report.hasChat && report.traceCount === 1 && report.childrenHaveAgentParent && report.canaryAbsent && report.canaryObservedBeforeFilter;
  const tool = report.code === 0 && report.hasTool && report.toolExecuted && report.childrenHaveAgentParent;
  return { captureQualified: !!capture, toolQualified: !!tool, stdoutCanaryObserved: !!report.outputContainedCanary, operations: report.operations, spanCount: report.spanCount, traceCount: report.traceCount, canaryAbsentAfterFilter: report.canaryAbsent, canaryObservedBeforeFilter: report.canaryObservedBeforeFilter, paidModelUsed: false, modelEvidence: 'synthetic local fixture', runtimeEvidence: 'real pinned native Copilot CLI', desktopBrowserQualified: false, azureQualified: false };
}
async function waitFor(check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { const value = await check(); if (value) return value; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Qualification state did not become ready.');
}
async function qualifyWindows({ outDir, sourceRoot = path.resolve(__dirname, '..') } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This qualification requires a disposable Windows x64 host.');
  if (!outDir || !path.isAbsolute(outDir)) throw new Error('A new absolute output directory is required.');
  fs.mkdirSync(outDir); // Refuse to reuse another run or normal profile.
  let stage = 'downloads', app, origin, token, lease, childExited;
  const reportFile = path.join(outDir, 'windows-qualification.json');
  const summary = { passed: false, platform: process.platform, arch: process.arch, runnerNode: process.version, pins: PINS, sourceClosure: sourceClosure(sourceRoot), desktopBrowserQualified: false, azureQualified: false, normalUserProfileQualified: false };
  try {
    const profile = path.join(outDir, 'profile'); fs.mkdirSync(profile);
    const storage = path.join(profile, 'AgentOps Native Companion'); fs.mkdirSync(storage); lease = path.join(storage, 'native-capture.lock');
    const runtime = path.join(profile, 'Programs', 'Microsoft VS Code'); fs.mkdirSync(runtime, { recursive: true });
    const vscodeArchive = path.join(outDir, 'vscode.zip'); await downloadFile(PINS.vscodeUrl, vscodeArchive); await verifyDigest(vscodeArchive, 'sha256', PINS.vscodeSha256);
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    const extract = (archive, destination, member) => { const result = spawnSync(tar, ['-xf', archive, '-C', destination, ...(member ? [member] : [])], { timeout: 120000, stdio: 'ignore' }); if (result.error || result.status !== 0) throw new Error('Verified archive extraction failed.'); };
    extract(vscodeArchive, runtime);
    const copilotArchive = path.join(outDir, 'copilot.tgz'); await downloadFile(PINS.copilotUrl, copilotArchive); await verifyDigest(copilotArchive, 'sha512', PINS.copilotSha512, 'base64');
    const copilotRoot = path.join(outDir, 'copilot'); fs.mkdirSync(copilotRoot); extract(copilotArchive, copilotRoot, 'package/copilot.exe');
    const copilot = path.join(copilotRoot, 'package', 'copilot.exe');
    if (collectorPackageInfo().version !== PINS.collectorVersion) throw new Error('Collector version no longer matches qualification pin.');
    const collector = await ensureCollector(storage);
    summary.collectorReleaseChecksumVerified = true;
    summary.collectorBinarySha256 = await digestFile(collector);
    const code = path.join(runtime, 'Code.exe');
    const runtimeVersion = spawnSync(code, ['--version'], { env: { ...cleanEnvironment(process.env), ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 10000 });
    if (runtimeVersion.error || runtimeVersion.status !== 0) throw new Error('Packaged VS Code Node runtime could not start.');
    summary.companionNodeRuntime = runtimeVersion.stdout.match(/v\d+\.\d+\.\d+/)?.[0] || 'unknown';
    stage = 'portable-launcher';
    const packaged = prepareNativeCompanionPackage({ sourceRoot, outDir: path.join(outDir, 'portable'), platform: 'win32' });
    const controlPort = await freePort();
    origin = `http://127.0.0.1:${controlPort}`;
    app = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'), ['/d', '/s', '/c', commandLine(path.join(packaged.appPath, 'Start AgentOps.cmd'), storage, controlPort)], { env: { ...cleanEnvironment(process.env), LOCALAPPDATA: profile }, stdio: 'ignore' });
    childExited = new Promise(resolve => { app.once('error', () => resolve({ code: null })); app.once('exit', (code, signal) => resolve({ code, signal })); });
    await waitFor(async () => { const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }); if (!response.ok) return; const html = await response.text(); return token = html.match(/const token="([a-f0-9]+)"/)?.[1]; });
    const post = action => fetch(origin + '/' + action, { method: 'POST', headers: { Origin: origin, 'X-AgentOps-Token': token, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(60000) });
    stage = 'collector-connect';
    if (!(await post('connect')).ok) throw new Error('Portable capture did not start.');
    const ownedPid = JSON.parse(fs.readFileSync(lease, 'utf8')).pid;
    const receiptRoot = path.join(storage, 'receipts');
    const run = fs.readdirSync(receiptRoot).find(name => name.startsWith('run-'));
    if (!run) throw new Error('Owned receipt directory missing.');
    stage = 'native-offline-runtime';
    const native = await qualify({ platform: 'win32', copilot, collectorEndpoint: 'http://127.0.0.1:4318', receiptPath: path.join(receiptRoot, run, 'native-receipt.jsonl') });
    summary.native = nativeProof(native);
    stage = 'quit-cleanup';
    if (!(await post('quit')).ok) throw new Error('Portable Quit was not acknowledged.');
    await waitFor(() => !fs.existsSync(lease));
    await waitFor(() => { try { process.kill(ownedPid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
    const exited = await Promise.race([childExited, new Promise((_, reject) => setTimeout(() => reject(new Error('Portable launcher did not exit.')), 5000))]);
    summary.launcherQualified = exited.code === 0;
    summary.ownerProcessGone = true; summary.leaseRemoved = true;
    summary.passed = summary.launcherQualified && summary.native.captureQualified && summary.native.toolQualified;
    summary.stage = summary.passed ? 'complete' : 'native-contract-unqualified';
    writeSummary(reportFile, summary);
    return summary;
  } catch {
    summary.stage = stage; summary.error = 'Windows qualification failed at this stage. No cloud or paid model was used.';
    writeSummary(reportFile, summary);
    return summary;
  } finally {
    if (origin && token && lease && fs.existsSync(lease)) { try { await fetch(origin + '/quit', { method: 'POST', headers: { Origin: origin, 'X-AgentOps-Token': token, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) }); } catch {} }
    if (app && app.exitCode === null) {
      await Promise.race([childExited, new Promise(resolve => setTimeout(resolve, 5000))]);
      if (app.exitCode === null && Number.isSafeInteger(app.pid)) spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000 });
    }
  }
}
function writeSummary(file, summary) { const text = JSON.stringify(summary, null, 2); if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Qualification summary exceeds 1 MiB.'); fs.writeFileSync(file, text); }
async function digestFile(file) { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
if (require.main === module) {
  const index = process.argv.indexOf('--out');
  qualifyWindows({ outDir: index > 0 ? path.resolve(process.argv[index + 1] || '') : undefined }).then(summary => { console.log(JSON.stringify(summary, null, 2)); process.exitCode = summary.passed ? 0 : 1; }).catch(() => { console.error('Windows qualification requires an explicit disposable Windows output directory.'); process.exitCode = 1; });
}
module.exports = { PINS, verifyDigest, commandLine, sourceClosure, nativeProof, qualifyWindows };
