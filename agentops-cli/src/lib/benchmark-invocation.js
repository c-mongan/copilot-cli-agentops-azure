function escapeResourceAttributeValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/,/g, '\\,');
}

function mergeResourceAttributes(existing, labels) {
  const benchmarkLabels = Object.entries(labels)
    .map(([key, value]) => `${key}=${escapeResourceAttributeValue(value)}`)
    .join(',');
  return [existing, benchmarkLabels].filter(Boolean).join(',');
}

function benchmarkSandboxProfile(run, workspace) {
  if (run.osSandbox?.mode !== 'macos-network-blocked') return null;
  const escapedWorkspace = workspace.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedHome = run.copilotHome.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    `(allow file-write* (subpath "${escapedWorkspace}") (subpath "${escapedHome}"))`
  ].join('\n');
}

function benchmarkCopilotInvocation(run, workspace, options = {}) {
  const copilotCommand = options.copilotCommand || run.copilot.command;
  const copilotArgs = [...run.copilot.args, '-p', run.copilot.prompt];
  if (run.osSandbox?.mode === 'container-network-blocked') {
    const runtime = options.containerRuntimeCommand || run.osSandbox.command || 'docker';
    return {
      command: runtime,
      args: [
        'run',
        '--rm',
        '--network',
        'none',
        '-v',
        `${workspace}:/workspace`,
        '-v',
        `${run.copilotHome}:/copilot-home`,
        '-w',
        '/workspace',
        '-e',
        'COPILOT_HOME=/copilot-home',
        run.osSandbox.image,
        copilotCommand,
        ...copilotArgs
      ],
      sandbox: {
        mode: run.osSandbox.mode,
        active: true,
        command: runtime,
        image: run.osSandbox.image,
        network: 'blocked'
      }
    };
  }
  if (run.osSandbox?.mode !== 'macos-network-blocked') {
    return {
      command: copilotCommand,
      args: copilotArgs,
      sandbox: { mode: run.osSandbox?.mode || 'none', active: false }
    };
  }
  const platform = options.platform || process.platform;
  if (platform !== 'darwin') {
    return {
      command: copilotCommand,
      args: copilotArgs,
      sandbox: {
        mode: run.osSandbox.mode,
        active: false,
        error: 'macos-network-blocked requires macOS sandbox-exec'
      }
    };
  }
  return {
    command: 'sandbox-exec',
    args: ['-p', benchmarkSandboxProfile(run, workspace), copilotCommand, ...copilotArgs],
    sandbox: { mode: run.osSandbox.mode, active: true, command: 'sandbox-exec' }
  };
}

module.exports = {
  benchmarkCopilotInvocation,
  benchmarkSandboxProfile,
  escapeResourceAttributeValue,
  mergeResourceAttributes
};
