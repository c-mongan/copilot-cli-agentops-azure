'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { createVsCodeAzureMonitorAuth } = require('./azure-auth');
const { createNativeAzureDelivery } = require('./azure-delivery');
const { readBackNativeEvents, maximumReadbackIds } = require('./azure-readback');
const consentKey = 'agentopsNative.azurePublishingConsent';
const mode = 'native-metadata-events-only';
const maximumDailyBytes = 16 * 1024 * 1024;
const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function readAzureDestination(vscode) {
  if (vscode.workspace.isTrusted !== true || vscode.env.remoteName) throw new Error('Azure publishing requires a trusted local workspace.');
  const inspected = vscode.workspace.getConfiguration().inspect('agentopsNative.azureDestination');
  if (!inspected || inspected.workspaceValue !== undefined || inspected.workspaceFolderValue !== undefined
    || inspected.policyValue !== undefined || inspected.globalLanguageValue !== undefined
    || inspected.workspaceLanguageValue !== undefined || inspected.workspaceFolderLanguageValue !== undefined) {
    throw new Error('Azure destination must be configured only in user settings.');
  }
  const value = inspected.globalValue;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Set the Azure destination in user settings first.');
  const { tenantId, subscriptionId, approvedSubscriptionIds, endpoint, dcrImmutableId, maxPublishBytesPerDay, readbackWorkspaceId } = value;
  if (![tenantId, subscriptionId].every(id => typeof id === 'string' && guid.test(id))
    || !Array.isArray(approvedSubscriptionIds) || !approvedSubscriptionIds.length
    || !approvedSubscriptionIds.every(id => typeof id === 'string' && guid.test(id))
    || !approvedSubscriptionIds.map(id => id.toLowerCase()).includes(subscriptionId.toLowerCase())
    || typeof dcrImmutableId !== 'string' || !/^dcr-[A-Za-z0-9-]+$/.test(dcrImmutableId)
    || !Number.isSafeInteger(maxPublishBytesPerDay) || maxPublishBytesPerDay < 1 || maxPublishBytesPerDay > maximumDailyBytes
    || (readbackWorkspaceId !== undefined && (typeof readbackWorkspaceId !== 'string' || !guid.test(readbackWorkspaceId)))) {
    throw new Error('Azure destination or publishing byte limit is invalid.');
  }
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Azure destination endpoint is invalid.'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.ingest.monitor.azure.com')
    || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Azure destination endpoint is invalid.');
  }
  const destination = { tenantId: tenantId.toLowerCase(), subscriptionId: subscriptionId.toLowerCase(),
    approvedSubscriptionIds: [...new Set(approvedSubscriptionIds.map(id => id.toLowerCase()))].sort(),
    endpoint: url.origin, dcrImmutableId, maxPublishBytesPerDay };
  // Optional, and added only when set, so existing approvals keep their hash.
  if (readbackWorkspaceId !== undefined) destination.readbackWorkspaceId = readbackWorkspaceId.toLowerCase();
  return destination;
}
const destinationHash = destination => crypto.createHash('sha256').update(JSON.stringify(destination)).digest('hex');

function createAzureControls(vscode, context, options = {}, deps = {}) {
  const storage = options.storage || context.globalStorageUri?.fsPath;
  if (!path.isAbsolute(storage || '')) throw new Error('Azure publishing requires local private profile storage.');
  const getReceipt = options.getReceipt;
  let delivery, activeHash, activeAbort, disposed = false, enabled = true, generation = 0;
  // Event IDs published by this window, kept in memory only for readback.
  let published = { hash: undefined, ids: [], total: 0 }, readAbort;

  function revokeDelivery() {
    activeAbort?.abort(); activeAbort = undefined; delivery = undefined; activeHash = undefined;
    readAbort?.abort(); readAbort = undefined;
  }

  function approvedDestination() {
    if (disposed || !enabled) throw new Error('Azure publishing is disabled.');
    const destination = readAzureDestination(vscode);
    const hash = destinationHash(destination);
    const consent = context.globalState.get(consentKey);
    if (!consent || consent.destinationHash !== hash || consent.mode !== mode
      || consent.maxPublishBytesPerDay !== destination.maxPublishBytesPerDay) {
      throw new Error('Enable Azure publishing and approve this destination first.');
    }
    return { destination, hash };
  }
  function prepare(destination, hash) {
    if (!delivery || activeHash !== hash) {
      const auth = (deps.createAuth || createVsCodeAzureMonitorAuth)(vscode, { tenantId: destination.tenantId });
      const ownedGeneration = generation;
      revokeDelivery();
      activeAbort = new AbortController();
      const assertStillApproved = () => {
        if (generation !== ownedGeneration || approvedDestination().hash !== hash) throw new Error('Azure publishing approval was revoked.');
        if (typeof getReceipt !== 'function' || !getReceipt()?.ownsCapture) throw new Error('Native capture ownership was lost.');
      };
      const tokenProvider = async () => {
        assertStillApproved();
        const token = await auth.tokenProvider();
        assertStillApproved();
        return token;
      };
      delivery = (deps.createDelivery || createNativeAzureDelivery)({ publishingApproved: true, storage,
        expectedSubscriptionId: destination.subscriptionId, approvedSubscriptionIds: destination.approvedSubscriptionIds,
        endpoint: destination.endpoint, dcrImmutableId: destination.dcrImmutableId,
        tokenProvider, abortSignal: activeAbort.signal,
        deliveryLimits: { maxPublishBytesPerDay: destination.maxPublishBytesPerDay } });
      activeHash = hash;
    }
    return delivery;
  }

  return {
    async enable() {
      if (disposed) throw new Error('Azure publishing controls are closed.');
      const requestGeneration = ++generation;
      revokeDelivery();
      const destination = readAzureDestination(vscode);
      const hash = destinationHash(destination);
      const receipt = typeof getReceipt === 'function' ? getReceipt() : null;
      if (!receipt?.ownsCapture) throw new Error('This window must own native capture before Azure publishing.');
      const chosen = await vscode.window.showWarningMessage(
        `Enable Azure publishing? Tenant: ${destination.tenantId}. Subscription: ${destination.subscriptionId}. Endpoint: ${destination.endpoint}. DCR: ${destination.dcrImmutableId}.${destination.readbackWorkspaceId ? ` Readback workspace: ${destination.readbackWorkspaceId}.` : ''} This sends native metadata events only. It excludes prompts, code, arbitrary names and full span waterfalls. The limit is ${destination.maxPublishBytesPerDay} bytes per day. Azure ingestion can incur charges; this byte limit is not a financial cap. Publishing is manual.`,
        { modal: true }, 'Enable Azure publishing');
      if (chosen !== 'Enable Azure publishing') return { enabled: false, cancelled: true };
      const auth = (deps.createAuth || createVsCodeAzureMonitorAuth)(vscode, { tenantId: destination.tenantId });
      await auth.signIn();
      if (disposed || generation !== requestGeneration || destinationHash(readAzureDestination(vscode)) !== hash) throw new Error('Azure destination or approval changed. Approve it again.');
      prepare(destination, hash);
      await context.globalState.update(consentKey, { destinationHash: hash, mode, maxPublishBytesPerDay: destination.maxPublishBytesPerDay });
      enabled = true;
      return { enabled: true, mode, publishing: 'manual', coverage: 'unknown', outcome: 'unknown' };
    },
    async publish() {
      const { destination, hash } = approvedDestination();
      const receipt = typeof getReceipt === 'function' ? getReceipt() : null;
      if (!receipt?.ownsCapture || typeof receipt.receiptPath !== 'string') throw new Error('This window has no owned native receipt to publish.');
      const { admittedIds, ...result } = await prepare(destination, hash).publishReceipt(receipt.receiptPath);
      if (published.hash !== hash) published = { hash, ids: [], total: 0 };
      if (Array.isArray(admittedIds)) {
        published.ids = [...published.ids, ...admittedIds].slice(-maximumReadbackIds);
        published.total += admittedIds.length;
      }
      return result;
    },
    async readback() {
      const { destination, hash } = approvedDestination();
      if (!destination.readbackWorkspaceId) throw new Error('Set readbackWorkspaceId in the Azure destination to verify cloud readback.');
      if (published.hash !== hash || !published.ids.length) throw new Error('Publish native metadata from this window before cloud readback.');
      const requestGeneration = generation;
      const auth = (deps.createAuth || createVsCodeAzureMonitorAuth)(vscode, { tenantId: destination.tenantId, resource: 'logAnalyticsRead' });
      // Readback is a user command, so an interactive read-scope sign-in is allowed.
      await auth.signIn();
      readAbort?.abort();
      const abort = readAbort = new AbortController();
      const tokenProvider = async () => {
        const token = await auth.tokenProvider();
        if (disposed || generation !== requestGeneration || approvedDestination().hash !== hash) throw new Error('Azure publishing approval was revoked.');
        return token;
      };
      try {
        const result = await (deps.readBack || readBackNativeEvents)({ workspaceId: destination.readbackWorkspaceId,
          eventIds: [...published.ids], tokenProvider, signal: abort.signal, fetch: deps.fetch });
        // Only the latest IDs are retained, so report sampling against everything published.
        return { ...result, total: published.total, sampled: published.total > published.ids.length };
      } finally { if (readAbort === abort) readAbort = undefined; }
    },
    async disable() {
      generation++;
      enabled = false; revokeDelivery(); published = { hash: undefined, ids: [], total: 0 };
      await context.globalState.update(consentKey, undefined);
      return { enabled: false, queuedDataRetained: true };
    },
    dispose() { generation++; disposed = true; revokeDelivery(); }
  };
}

module.exports = { createAzureControls, readAzureDestination, destinationHash, maximumDailyBytes };
