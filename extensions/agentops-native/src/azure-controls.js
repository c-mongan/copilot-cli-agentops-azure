'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { createVsCodeAzureMonitorAuth } = require('./azure-auth');
const { createNativeAzureDelivery } = require('./azure-delivery');
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
  const { tenantId, subscriptionId, approvedSubscriptionIds, endpoint, dcrImmutableId, maxPublishBytesPerDay } = value;
  if (![tenantId, subscriptionId].every(id => typeof id === 'string' && guid.test(id))
    || !Array.isArray(approvedSubscriptionIds) || !approvedSubscriptionIds.length
    || !approvedSubscriptionIds.every(id => typeof id === 'string' && guid.test(id))
    || !approvedSubscriptionIds.map(id => id.toLowerCase()).includes(subscriptionId.toLowerCase())
    || typeof dcrImmutableId !== 'string' || !/^dcr-[A-Za-z0-9-]+$/.test(dcrImmutableId)
    || !Number.isSafeInteger(maxPublishBytesPerDay) || maxPublishBytesPerDay < 1 || maxPublishBytesPerDay > maximumDailyBytes) {
    throw new Error('Azure destination or publishing byte limit is invalid.');
  }
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Azure destination endpoint is invalid.'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.ingest.monitor.azure.com')
    || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Azure destination endpoint is invalid.');
  }
  return { tenantId: tenantId.toLowerCase(), subscriptionId: subscriptionId.toLowerCase(),
    approvedSubscriptionIds: [...new Set(approvedSubscriptionIds.map(id => id.toLowerCase()))].sort(),
    endpoint: url.origin, dcrImmutableId, maxPublishBytesPerDay };
}
const destinationHash = destination => crypto.createHash('sha256').update(JSON.stringify(destination)).digest('hex');

function createAzureControls(vscode, context, options = {}, deps = {}) {
  const storage = options.storage || context.globalStorageUri?.fsPath;
  if (!path.isAbsolute(storage || '')) throw new Error('Azure publishing requires local private profile storage.');
  const getReceipt = options.getReceipt;
  let delivery, activeHash, activeAbort, disposed = false, enabled = true, generation = 0;

  function revokeDelivery() {
    activeAbort?.abort(); activeAbort = undefined; delivery = undefined; activeHash = undefined;
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
        `Enable Azure publishing? Tenant: ${destination.tenantId}. Subscription: ${destination.subscriptionId}. Endpoint: ${destination.endpoint}. DCR: ${destination.dcrImmutableId}. This sends native metadata events only. It excludes prompts, code, arbitrary names and full span waterfalls. The limit is ${destination.maxPublishBytesPerDay} bytes per day. Azure ingestion can incur charges; this byte limit is not a financial cap. Publishing is manual.`,
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
      return prepare(destination, hash).publishReceipt(receipt.receiptPath);
    },
    async disable() {
      generation++;
      enabled = false; revokeDelivery();
      await context.globalState.update(consentKey, undefined);
      return { enabled: false, queuedDataRetained: true };
    },
    dispose() { generation++; disposed = true; revokeDelivery(); }
  };
}

module.exports = { createAzureControls, readAzureDestination, destinationHash, maximumDailyBytes };
