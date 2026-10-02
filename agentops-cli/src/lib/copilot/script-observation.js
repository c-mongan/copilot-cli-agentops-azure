const fs = require('node:fs');
const path = require('node:path');

const { gitRoot, readOwnedAttachment } = require('../attach-command');

function scriptTraceEndpoint(env = {}, collectorMode = 'auto') {
  if (env.AGENTOPS_SCRIPT_OTLP_ENDPOINT) return env.AGENTOPS_SCRIPT_OTLP_ENDPOINT;
  if (collectorMode === 'none') return '';
  const configured = String(env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318').replace(/\/+$/, '');
  return configured.endsWith('/v1/traces') ? configured : `${configured}/v1/traces`;
}

function executableOnPath(name, pathValue, cwd = process.cwd(), excludedRoot = '') {
  for (const entry of String(pathValue || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(cwd, entry, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (!fs.statSync(candidate).isFile()) continue;
      const resolved = fs.realpathSync(candidate);
      if (excludedRoot && (resolved === excludedRoot || resolved.startsWith(`${excludedRoot}${path.sep}`))) continue;
      // Launch the PATH entry itself. Resolving a virtualenv interpreter
      // symlink to its base binary would change sys.prefix and site-packages.
      return candidate;
    } catch {
      // Continue through the caller's original PATH. The scoped shim is added
      // only after these real interpreter paths have been resolved.
    }
  }
  return '';
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
  delete result.AGENTOPS_PYTHON_LAUNCHER_CHILD;
  delete result.AGENTOPS_PYTHON_WRAPPER_NAME;
  const currentPythonPath = String(env.PYTHONPATH || '').split(path.delimiter).filter(Boolean);
  if (!currentPythonPath.includes(bootstrapPath)) {
    result.PYTHONPATH = [bootstrapPath, ...currentPythonPath].join(path.delimiter);
  }
  if (process.platform !== 'win32') {
    const originalPath = String(env.PATH || '');
    const realPython = executableOnPath('python', originalPath, cwd, bootstrapPath);
    const realPython3 = executableOnPath('python3', originalPath, cwd, bootstrapPath);
    if (realPython) result.AGENTOPS_REAL_PYTHON = realPython;
    if (realPython3) result.AGENTOPS_REAL_PYTHON3 = realPython3;
    if (realPython || realPython3) {
      const currentPath = originalPath.split(path.delimiter).filter(Boolean);
      const shimPaths = [
        ...(realPython3 ? [path.join(bootstrapPath, 'bin-python3')] : []),
        ...(realPython ? [path.join(bootstrapPath, 'bin-python')] : [])
      ];
      result.PATH = [...shimPaths.filter(shimPath => !currentPath.includes(shimPath)), ...currentPath].join(path.delimiter);
    }
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

module.exports = { attachedScriptEnvironment, executableOnPath, scriptTraceEndpoint };
