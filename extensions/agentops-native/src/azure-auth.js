'use strict';

// Public Azure only. Keep the resource scope fixed: configuration must never
// turn this adapter into an arbitrary token acquisition/exfiltration helper.
const azureMonitorScope = 'https://monitor.azure.com//.default';
// Readback uses a separate fixed read scope. Callers pick a name, never a URL.
const logAnalyticsReadScope = 'https://api.loganalytics.io/.default';
const resourceScopes = Object.freeze({ monitor: azureMonitorScope, logAnalyticsRead: logAnalyticsReadScope });
const guidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function createVsCodeAzureMonitorAuth(vscode, options = {}) {
  const tenantId = typeof options.tenantId === 'string' ? options.tenantId.trim().toLowerCase() : '';
  if (!guidPattern.test(tenantId)) throw new Error('Azure publishing requires an explicit directory tenant ID.');
  if (typeof vscode?.authentication?.getSession !== 'function') {
    throw new Error('Microsoft authentication is unavailable.');
  }
  const resource = options.resource ?? 'monitor';
  if (!Object.hasOwn(resourceScopes, resource)) throw new Error('Azure sign-in resource is not supported.');
  const scopes = Object.freeze([resourceScopes[resource], `VSCODE_TENANT:${tenantId}`]);

  async function session(interactive) {
    let result;
    try {
      result = await vscode.authentication.getSession('microsoft', [...scopes],
        interactive ? { createIfNone: true } : { silent: true });
    } catch {
      // Provider errors can contain account data. Return only a fixed error.
      throw new Error(interactive ? 'Microsoft sign-in was not completed.' : 'Azure publishing requires Microsoft sign-in.');
    }
    if (!result || typeof result.accessToken !== 'string' || !result.accessToken.trim()) {
      throw new Error('Azure publishing requires Microsoft sign-in.');
    }
    return result;
  }

  return Object.freeze({
    // Call only from a user-approved sign-in action. Do not return the account
    // or token to UI state, settings, a report, or an outbox.
    async signIn() { await session(true); return { signedIn: true }; },
    // The built-in Microsoft provider owns secure caching and token renewal.
    // Background delivery does not open login prompts. No JWT decoding here:
    // the server checks token audience, tenant, expiry and DCR authorization.
    async tokenProvider() { return (await session(false)).accessToken; }
  });
}

module.exports = { azureMonitorScope, logAnalyticsReadScope, createVsCodeAzureMonitorAuth };
