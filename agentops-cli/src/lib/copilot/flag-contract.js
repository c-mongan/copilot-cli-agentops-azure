const trackedFlags = [
  '--mode',
  '--plan',
  '--autopilot',
  '--model',
  '--effort',
  '--reasoning-effort',
  '--output-format',
  '--remote',
  '--no-remote',
  '--agent',
  '--stream',
  '--acp',
  '-C',
  '--session-id',
  '--share',
  '--share-gist',
  '--attachment',
  '--plugin-dir',
  '--additional-mcp-config',
  '--disable-mcp-server',
  '--add-github-mcp-tool',
  '--add-github-mcp-toolset',
  '--enable-all-github-mcp-tools',
  '--disable-builtin-mcps',
  '--allow-all',
  '--yolo',
  '--allow-all-tools',
  '--allow-all-paths',
  '--allow-all-urls',
  '--allow-tool',
  '--allow-url',
  '--deny-tool',
  '--deny-url',
  '--available-tools',
  '--excluded-tools',
  '--secret-env-vars'
];

const ignoredCopilotFlags = [
  '--help',
  '--version',
  '--prompt',
  '-h',
  '-p'
];

const agentOpsOnlyFlags = [
  '--collector-mode',
  '--privacy',
  '--unsafe-no-collector'
];

const knownFlags = new Set([
  ...trackedFlags,
  ...ignoredCopilotFlags,
  ...agentOpsOnlyFlags
]);

function parseCopilotHelpFlags(helpText = '') {
  const flags = new Set();
  const pattern = /(^|[\s,(])(-{1,2}[A-Za-z][A-Za-z0-9-]*)(?=($|[\s,)=:]))/gm;
  let match;
  while ((match = pattern.exec(helpText)) !== null) {
    flags.add(match[2]);
  }
  return [...flags].sort();
}

function auditCopilotHelpFlags(helpText = '') {
  const discovered = parseCopilotHelpFlags(helpText);
  const unknown = discovered.filter(flag => !knownFlags.has(flag));
  return {
    ok: unknown.length === 0,
    discovered,
    unknown,
    tracked: trackedFlags,
    ignored: ignoredCopilotFlags,
    agentops_only: agentOpsOnlyFlags
  };
}

module.exports = {
  agentOpsOnlyFlags,
  auditCopilotHelpFlags,
  ignoredCopilotFlags,
  knownFlags,
  parseCopilotHelpFlags,
  trackedFlags
};
