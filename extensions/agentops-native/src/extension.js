const { startRecorder, reportReceipt, reportHtml, readProfileState, writeProfileState, acquireProfileLease, releaseProfileLease } = require('./recorder');
const settings = require('./native-settings');
const { createAzureControls } = require('./azure-controls');
const { createScriptControls } = require('./script-controls');

function createController(vscode, context, deps = {}) {
  const nativeSettings = deps.settings || settings;
  const storage = context.globalStorageUri.fsPath;
  const profile = deps.profile || { readProfileState, writeProfileState, acquireProfileLease, releaseProfileLease };
  let state = context.globalState.get('nativeCapture', { optedIn: false });
  let profileError;
  try { state = profile.readProfileState(storage) || state; } catch (error) { profileError = error; }
  let lease;
  const ownProfile = () => {
    if (profileError) throw profileError;
    if (!lease) {
      const acquired = profile.acquireProfileLease(storage);
      try { state = profile.readProfileState(storage) || context.globalState.get('nativeCapture', { optedIn: false }); }
      catch (error) { profile.releaseProfileLease(acquired); throw error; }
      lease = acquired;
    }
  };
  const persistState = async () => {
    if (!lease) throw new Error('Native profile ownership is required.');
    profile.writeProfileState(storage, state);
    await context.globalState.update('nativeCapture', state);
  };
  let collector;
  let reloadRequired = false;
  let pending = Promise.resolve();
  let closing = false;
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBar.command = 'agentopsNative.status';
  const update = text => { statusBar.text = `$(pulse) AgentOps: ${text}`; statusBar.show(); };
  update('Off');
  const permitted = () => vscode.workspace.isTrusted && !vscode.env.remoteName && ['file', 'vscode-userdata'].includes(context.globalStorageUri.scheme) && require('node:path').isAbsolute(context.globalStorageUri.fsPath);
  const clearEnvironment = () => context.environmentVariableCollection.clear();
  const restore = () => nativeSettings.disconnectNativeSettings(vscode, { state, persistState });
  const stop = async (forget = true) => {
    if (!lease) return;
    clearEnvironment();
    const active = collector;
    let restoreError;
    if (forget) { try { await restore(); } catch (error) { restoreError = error; } }
    if (active) {
      try { await active.stop({ remove: false }); }
      catch (error) { update('Shutdown error'); throw error; }
    }
    collector = undefined;
    if (forget) { state.optedIn = false; await persistState(); }
    update(restoreError ? 'Restore needed' : 'Off');
    if (restoreError) throw restoreError;
    profile.releaseProfileLease(lease);
    lease = undefined;
  };
  const serialize = action => {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  };
  const connect = automatic => serialize(async () => {
    if (collector || closing) return;
    if (!permitted()) { update('Blocked'); if (!automatic) await vscode.window.showWarningMessage('AgentOps requires a trusted local workspace. Remote workspaces are not supported.'); return; }
    if (!automatic) {
      const answer = await vscode.window.showInformationMessage('Connect AgentOps native capture?', { modal: true, detail: 'AgentOps will download the official checksum-verified OpenTelemetry Collector if needed. It will enable local Copilot telemetry and set telemetry variables in new integrated terminals. Other programs that use these variables can also emit telemetry. Strict filtering runs locally. No data is sent to Azure. Existing and external terminals are not covered.' }, 'Connect');
      if (answer !== 'Connect') return;
    }
    try { ownProfile(); } catch {
      update('Profile blocked');
      if (!automatic) await vscode.window.showWarningMessage('Another VS Code window owns capture, or the profile recovery record needs repair. Use the owning window to disconnect.');
      return;
    }
    update('Starting');
    try {
      // Keep the startup configuration and endpoint across ordinary host reloads.
      const endpoint = state.endpoint || state.settingsSnapshot?.endpoint;
      if (state.endpoint && state.settingsSnapshot && state.endpoint !== state.settingsSnapshot.endpoint) throw new Error('Saved native endpoint conflicts with its settings record.');
      reloadRequired = !state.settingsSnapshot;
      collector = await (deps.startRecorder || startRecorder)(context.globalStorageUri.fsPath, { endpoint });
      if (endpoint && collector.endpoint !== endpoint) throw new Error('Collector did not restart on the saved endpoint.');
      delete state.lastStopReason;
      state.endpoint = collector.endpoint;
      state.receiptPath = collector.receiptPath;
      await persistState();
      const result = await nativeSettings.connectNativeSettings(vscode, { endpoint: collector.endpoint, state, persistState, env: deps.env });
      if (!result.connected) throw new Error('Native Copilot settings are not available or conflict with existing telemetry settings.');
      context.environmentVariableCollection.persistent = false;
      for (const [key, value] of Object.entries(nativeSettings.nativeTerminalEnvironment(collector.endpoint))) context.environmentVariableCollection.replace(key, value);
      state.agentHostSupported = result.agentHostSupported === true;
      state.optedIn = true;
      await persistState();
      update(reloadRequired ? 'Chat reload required' : 'Collector ready; Chat unverified');
      const active = collector;
      active.exited?.then(result => {
        if (collector === active && !closing) {
          state.lastStopReason = ['output_limit', 'output_monitor_failed'].includes(result?.reason) ? result.reason : 'collector_exited';
          disconnect().then(() => update(state.lastStopReason === 'output_limit' ? 'Stopped: local size limit' : 'Collector stopped')).catch(() => {});
        }
      });
    } catch (error) {
      if (['storage_limit', 'storage_scan_limit', 'storage_scan_unsafe'].includes(error.reason)) state.lastStopReason = error.reason;
      let cleanupFailed = false;
      try { await stop(true); } catch { cleanupFailed = true; }
      update(cleanupFailed ? 'Recovery needed' : 'Error');
      if (!automatic) await vscode.window.showErrorMessage(cleanupFailed
        ? 'AgentOps could not connect. Cleanup is incomplete. The settings recovery record is retained. Retry Disconnect native capture.'
        : 'AgentOps could not connect. Owned settings were restored. Check native Copilot support and Collector access.');
      throw error;
    }
  });
  const disconnect = () => serialize(async () => { ownProfile(); await stop(true); });
  const status = async () => {
    if (!collector && ['storage_limit', 'storage_scan_limit', 'storage_scan_unsafe'].includes(state.lastStopReason)) return vscode.window.showInformationMessage('AgentOps cannot start because retained local receipt storage reached its limit or cannot be checked safely. No receipts were deleted. Review retained local reports before starting again.');
    if (!collector && state.lastStopReason === 'output_limit') return vscode.window.showInformationMessage('AgentOps stopped capture because the combined local receipt and log reached the 12 MiB sampled size limit. The receipt was retained. Capture coverage is incomplete. Open the local report or connect again for a new receipt.');
    if (!collector && state.lastStopReason === 'output_monitor_failed') return vscode.window.showInformationMessage('AgentOps stopped capture because it could not check local output size safely. Capture coverage is incomplete.');
    if (!collector) return vscode.window.showInformationMessage(state.settingsSnapshot
      ? 'AgentOps is off. Settings recovery is incomplete. Retry Disconnect native capture.'
      : 'AgentOps is off. Run AgentOps: Connect native capture to start.');
    let observed = 'Telemetry received: unknown. The receipt could not be read safely.';
    try {
      const report = (deps.reportReceipt || reportReceipt)(collector.receiptPath);
      observed = report.nativeSpanCount > 0 ? `Telemetry received: ${report.nativeSpanCount} native spans.` : 'No supported native spans have been parsed yet.';
      update(report.nativeSpanCount > 0 ? 'Data received; Chat unverified' : reloadRequired ? 'Chat reload required' : 'Collector ready; Chat unverified');
    } catch { update('Collector ready; data unknown'); }
    const hostStatus = state.agentHostSupported === false ? 'Native Agent Host capture is unavailable in this client; Copilot Chat and new integrated terminals are configured. ' : '';
    return vscode.window.showInformationMessage(`Collector is ready. ${observed} ${hostStatus}Copilot Chat export is unverified. ${reloadRequired ? 'Reload VS Code for the new Chat settings to take effect. ' : ''}Capture coverage and task success remain unknown. Restart Copilot if native settings have not taken effect. Only new integrated terminals receive the capture environment.`);
  };

  const openReport = async () => {
    if (!state.receiptPath) return vscode.window.showInformationMessage('No AgentOps receipt is available.');
    try {
      const report = (deps.reportReceipt || reportReceipt)(state.receiptPath);
      const panel = vscode.window.createWebviewPanel('agentopsNativeReport', 'AgentOps native report', vscode.ViewColumn.One, { enableScripts: false, localResourceRoots: [] });
      panel.webview.html = reportHtml(report);
    } catch { await vscode.window.showErrorMessage('The local receipt cannot be read safely. It may exceed the 16 MiB report limit.'); }
  };
  const startCopilotTerminal = async () => {
    if (!collector) { await connect(false); if (!collector) return; }
    const terminal = vscode.window.createTerminal({ name: 'Copilot with AgentOps', env: nativeSettings.nativeTerminalEnvironment(collector.endpoint) });
    terminal.show();
    terminal.sendText('copilot', true);
  };
  const dispose = async () => { closing = true; await serialize(() => stop(false)); statusBar.dispose(); };
  return { connect, disconnect, status, openReport, startCopilotTerminal, dispose, optedIn: () => state.optedIn, captureContext: () => collector && lease ? { ownsCapture: true, storage, endpoint: collector.endpoint, receiptPath: collector.receiptPath } : undefined };
}

let controller, azureControls, scriptControls;
function activate(context) {
  const vscode = require('vscode');
  controller = createController(vscode, context);
  azureControls = createAzureControls(vscode, context, { getReceipt: controller.captureContext });
  scriptControls = createScriptControls(vscode, { captureContext: controller.captureContext });
  for (const [command, method] of Object.entries({ connect: () => controller.connect(false), disconnect: controller.disconnect, status: controller.status, openReport: controller.openReport, startCopilotTerminal: controller.startCopilotTerminal })) {
    context.subscriptions.push(vscode.commands.registerCommand(`agentopsNative.${command}`, async () => { try { await method(); } catch {} }));
  }
  const additional = {
    traceScript: scriptControls.startSelectedScript,
    enableAzure: async () => { const result = await azureControls.enable(); if (result.enabled) await vscode.window.showInformationMessage('Azure publishing is enabled for the approved destination. Publishing is manual. Run AgentOps: Publish native metadata to Azure.'); },
    publishAzure: async () => { const result = await azureControls.publish(); await vscode.window.showInformationMessage(`Azure accepted ${result.acknowledged} metadata events. Refused: ${result.refused}. Cloud readback, coverage and task outcome remain unverified. Full span waterfalls and library spans are not published by this path.`); },
    disableAzure: async () => { await azureControls.disable(); await vscode.window.showInformationMessage('Azure publishing is disabled. Queued metadata is retained.'); }
  };
  for (const [command, method] of Object.entries(additional)) {
    context.subscriptions.push(vscode.commands.registerCommand(`agentopsNative.${command}`, async () => {
      try { await method(); } catch { await vscode.window.showErrorMessage('AgentOps could not complete this action. Check local capture, user-level Azure destination settings and sign-in. No cloud receipt is confirmed.'); }
    }));
  }
  if (controller.optedIn()) controller.connect(true).catch(() => {});
}
async function deactivate() { scriptControls?.dispose(); azureControls?.dispose(); await controller?.dispose(); }
module.exports = { activate, deactivate, createController };
