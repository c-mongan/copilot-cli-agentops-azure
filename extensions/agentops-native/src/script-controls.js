'use strict';
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

function defaultPrepare(options) {
  // A packaged extension must use its owned runtime; do not silently fall back.
  const bundled = fs.existsSync(path.join(__dirname, '../runtime/package.json'));
  const module = bundled ? require('../runtime/instrumentation/auto/plan.cjs') : require('../../../instrumentation/auto/plan.cjs');
  return module.prepareAutoInstrumentation(options);
}

function createScriptControls(vscode, options = {}) {
  const captureContext = options.captureContext || (() => undefined);
  const prepare = options.prepareAutoInstrumentation || defaultPrepare;
  const spawn = options.spawn || childProcess.spawn;
  const baseEnv = options.env || process.env;
  const isElectronRuntime = options.isElectronRuntime || (() => Boolean(process.versions.electron));
  let active;
  let disposed = false;
  const permitted = () => !disposed && vscode.workspace.isTrusted && !vscode.env.remoteName;
  const stop = () => {
    if (!active || active.stopping) return;
    active.stopping = true;
    active.child.kill('SIGTERM');
    active.timer = setTimeout(() => { if (active) active.child.kill('SIGKILL'); }, 2000);
  };
  const startSelectedScript = async () => {
    if (!permitted()) {
      await vscode.window.showWarningMessage('Project tracing requires a trusted local workspace. Remote workspaces are not supported.');
      return { started: false, reason: 'workspace' };
    }
    if (active) {
      await vscode.window.showWarningMessage('A project script is already running. Cancel that run before starting another.');
      return { started: false, reason: 'already-running' };
    }
    const initial = captureContext();
    if (!initial?.endpoint) {
      await vscode.window.showWarningMessage('Connect native capture before tracing a selected project script.');
      return { started: false, reason: 'capture-off' };
    }
    const folders = (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file');
    if (!folders.length) {
      await vscode.window.showWarningMessage('Open a local project folder before tracing a script.');
      return { started: false, reason: 'no-project' };
    }
    const folder = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(folders.map(value => ({ label: value.name, folder: value })), { title: 'Select the project scope' }).then(value => value?.folder);
    if (!folder) return { started: false, reason: 'cancelled' };
    const selected = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, defaultUri: folder.uri, title: 'Select a project script to trace', filters: { 'Python or JavaScript': ['py', 'js', 'cjs', 'mjs'] } });
    if (!selected?.[0] || selected[0].scheme !== 'file') return { started: false, reason: 'cancelled' };
    const entry = selected[0].fsPath;
    const extension = path.extname(entry).toLowerCase();
    if (!['.py', '.js', '.cjs', '.mjs'].includes(extension)) {
      await vscode.window.showWarningMessage('Select a Python or JavaScript file. Compile TypeScript to JavaScript first.');
      return { started: false, reason: 'unsupported-entry' };
    }
    const runtime = extension === '.py' ? 'python' : 'node';
    let mode = extension === '.mjs' ? 'esm' : 'cjs';
    if (extension === '.js') {
      const choice = await vscode.window.showQuickPick([{ label: 'CommonJS', mode: 'cjs' }, { label: 'ES modules', mode: 'esm' }], { title: 'Select the JavaScript module format' });
      if (!choice) return { started: false, reason: 'cancelled' };
      mode = choice.mode;
    }
    const executable = await vscode.window.showInputBox({
      title: runtime === 'python' ? 'Select the project Python interpreter' : 'Select the project Node executable',
      prompt: 'Enter an absolute executable path. No command or arguments.',
      value: runtime === 'node' ? process.execPath : '',
      ignoreFocusOut: true,
      validateInput: value => path.isAbsolute(value) ? undefined : 'An absolute executable path is required.'
    });
    if (!executable) return { started: false, reason: 'cancelled' };
    const consent = await vscode.window.showInformationMessage('Run this selected project script with local library tracing?', {
      modal: true,
      detail: 'The script runs with your user permissions and can change files or contact services. This command adds local tracing for installed supported libraries. It does not install packages or start Azure delivery. If Azure delivery is already enabled, the connected capture path can forward filtered data. Arguments and interactive input are not supported. Script output is not collected. Other processes are not instrumented. Cancel can stop this process, but not its child processes. Native capture must remain connected.'
    }, 'Run selected script');
    if (consent !== 'Run selected script') return { started: false, reason: 'cancelled' };
    const current = captureContext();
    if (!permitted() || active || current?.endpoint !== initial.endpoint) {
      await vscode.window.showWarningMessage('The project or capture state changed. Start the script again after capture is ready.');
      return { started: false, reason: 'state-changed' };
    }
    let plan;
    try {
      plan = prepare({ runtime, executable, entry, projectRoot: folder.uri.fsPath, endpoint: current.endpoint, runId: current.runId || `project-${Date.now()}`, traceparent: current.traceparent || '', mode, args: [], electronRuntime: runtime === 'node' && executable === process.execPath && isElectronRuntime() });
    } catch {
      await vscode.window.showErrorMessage('The script plan is invalid. Select a file inside the project and a supported absolute interpreter path.');
      return { started: false, reason: 'invalid-plan' };
    }
    if (!plan.supported) {
      const required = Array.isArray(plan.requirements) ? plan.requirements.filter(value => typeof value === 'string' && /^[A-Za-z0-9@/._ -]{1,160}$/.test(value)).join(', ') : 'project OpenTelemetry packages';
      await vscode.window.showWarningMessage(`Project tracing needs these installed requirements: ${required || 'project OpenTelemetry packages'}. No packages were installed.`);
      return { started: false, reason: 'requirements' };
    }
    const run = async (_progress, token) => {
      if (!permitted() || active || captureContext()?.endpoint !== initial.endpoint) {
        await vscode.window.showWarningMessage('Capture is no longer ready. Start the selected script again after capture is connected.');
        return { started: false, reason: 'state-changed' };
      }
      let child;
      try {
        const env = { ...baseEnv, ...plan.env };
        if (runtime === 'node' && executable === process.execPath && isElectronRuntime()) env.ELECTRON_RUN_AS_NODE = '1';
        child = spawn(plan.command, plan.args, { cwd: plan.cwd, env, shell: false, stdio: ['ignore', 'ignore', 'ignore'] });
      } catch {
        await vscode.window.showErrorMessage('The selected script process could not start.');
        return { started: false, reason: 'spawn' };
      }
      active = { child, stopping: false };
      const cancellation = token?.onCancellationRequested(stop);
      if (token?.isCancellationRequested) stop();
      const result = await new Promise(resolve => {
        let finished = false;
        const finish = result => { if (finished) return; finished = true; resolve(result); };
        child.once('error', () => finish({ started: false, reason: 'spawn' }));
        child.once('close', (code, signal) => finish({ started: true, exitCode: code, signal: signal || null, cancelled: active?.stopping === true }));
      });
      clearTimeout(active?.timer);
      active = undefined;
      cancellation?.dispose();
      if (!result.started) await vscode.window.showErrorMessage('The selected script process could not start.');
      else if (result.cancelled || result.signal) await vscode.window.showWarningMessage('The selected script stopped. Buffered spans can be lost on termination. Telemetry delivery is unverified.');
      else if (result.exitCode !== 0) await vscode.window.showWarningMessage(`The selected script exited with code ${Number.isInteger(result.exitCode) ? result.exitCode : 'unknown'}. Telemetry delivery is unverified.`);
      else await vscode.window.showInformationMessage('The selected script exited successfully. Supported libraries could emit local spans. Use the capture report to check receipt; Azure delivery is unverified.');
      return result;
    };
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'AgentOps: selected project script', cancellable: true }, run);
  };
  return { startSelectedScript, stop, dispose: () => { disposed = true; stop(); } };
}
module.exports = { createScriptControls };
