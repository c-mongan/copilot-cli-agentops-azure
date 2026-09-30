const path = require('node:path');

const { gitRoot, readOwnedAttachment } = require('../attach-command');

function scriptTraceEndpoint(env = {}, collectorMode = 'auto') {
  if (env.AGENTOPS_SCRIPT_OTLP_ENDPOINT) return env.AGENTOPS_SCRIPT_OTLP_ENDPOINT;
  if (collectorMode === 'none') return '';
  const configured = String(env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318').replace(/\/+$/, '');
  return configured.endsWith('/v1/traces') ? configured : `${configured}/v1/traces`;
}

function attachedScriptEnvironment({ env = process.env, cwd = process.cwd(), runId, agentopsRoot, collectorMode = 'auto' } = {}) {
  let root;
  try {
    root = gitRoot(cwd);
  } catch {
    return { ...env };
  }
  let attachment;
  try {
    attachment = readOwnedAttachment(root);
  } catch {
    return { ...env };
  }
  if (!attachment.ok) return { ...env };

  const endpoint = scriptTraceEndpoint(env, collectorMode);
  const result = {
    ...env,
    AGENTOPS_ATTACHMENT_MANIFEST: attachment.paths.manifest,
    AGENTOPS_REPO_ROOT: root,
    AGENTOPS_RUN_ID: runId
  };
  if (endpoint) result.AGENTOPS_SCRIPT_OTLP_ENDPOINT = endpoint;

  const bootstrapPath = path.join(agentopsRoot, 'instrumentation', 'python');
  const currentPythonPath = String(env.PYTHONPATH || '').split(path.delimiter).filter(Boolean);
  if (!currentPythonPath.includes(bootstrapPath)) {
    result.PYTHONPATH = [bootstrapPath, ...currentPythonPath].join(path.delimiter);
  }
  const nodePreload = path.join(agentopsRoot, 'instrumentation', 'node', 'preload.cjs');
  const currentNodeOptions = String(env.NODE_OPTIONS || '');
  if (!currentNodeOptions.includes(nodePreload)) {
    result.NODE_OPTIONS = [`--require=${JSON.stringify(nodePreload)}`, currentNodeOptions].filter(Boolean).join(' ');
  }
  const nodeHelperPath = path.join(agentopsRoot, 'instrumentation', 'node');
  const currentNodePath = String(env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
  if (!currentNodePath.includes(nodeHelperPath)) {
    result.NODE_PATH = [nodeHelperPath, ...currentNodePath].join(path.delimiter);
  }
  return result;
}

module.exports = { attachedScriptEnvironment, scriptTraceEndpoint };
