const fs = require('node:fs');
const path = require('node:path');

const primitiveDefinitions = [
  ['custom_agents', 'Configured custom agents plus runtime invoke_agent spans.'],
  ['subagents', 'Subagent and /fleet flow reconstruction from parent/child spans and subagent lifecycle events.'],
  ['skills', 'Configured SKILL.md bundles plus runtime skill events.'],
  ['hooks', 'Configured hooks plus runtime hook events.'],
  ['mcp_servers', 'Configured MCP servers and runtime MCP tool spans.'],
  ['mcp_tools', 'MCP tool calls inferred from namespaced tool spans.'],
  ['built_in_tools', 'Built-in Copilot tool calls from execute_tool spans.'],
  ['instructions', 'AGENTS.md, copilot-instructions.md, and *.instructions.md files.'],
  ['plugins', 'Plugin manifests and bundled plugin assets.'],
  ['workflows_commands', 'Agentic workflows or command markdown files.'],
  ['lsp_servers', 'Configured LSP server definitions.'],
  ['benchmarks', 'AgentOps benchmark suites.'],
  ['acp', 'Copilot ACP server mode flag telemetry.'],
  ['attachments', 'Attachment count telemetry.'],
  ['policy', 'Policy hooks, permission decisions, and safety blocks.'],
  ['context_events', 'Truncation, compaction, and context pressure telemetry.']
];

function collectFiles(baseRoot, relativeDirs, predicate) {
  const results = [];
  const seen = new Set();
  const dirs = Array.isArray(relativeDirs) ? relativeDirs : [relativeDirs];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['.git', 'node_modules', 'dist', 'build', '.next', '.turbo'].includes(entry.name)) continue;
        walk(fullPath);
      }
      if (entry.isFile() && predicate(fullPath) && !seen.has(fullPath)) {
        seen.add(fullPath);
        results.push(fullPath);
      }
    }
  }

  for (const relativeDir of dirs) walk(path.join(baseRoot, relativeDir));
  return results;
}

function relativePaths(baseRoot, files, limit = 25) {
  return files.slice(0, limit).map(file => path.relative(baseRoot, file));
}

function countHookEvents(hookFiles) {
  const events = new Set();
  for (const file of hookFiles) {
    try {
      const hooks = JSON.parse(fs.readFileSync(file, 'utf8')).hooks || {};
      Object.keys(hooks).forEach(event => events.add(event));
    } catch {
      // Ignore malformed hook samples during inventory; validation catches real repo files.
    }
  }
  return events;
}

function mcpServerNames(baseRoot, mcpFiles) {
  const servers = new Set();
  for (const file of mcpFiles) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.keys(payload.mcpServers || payload.servers || {}).forEach(server => servers.add(server));
    } catch {
      // Ignore malformed sample files during inventory.
    }
  }

  const pluginFiles = collectFiles(baseRoot, ['.', 'plugin', 'plugins'], file => path.basename(file) === 'plugin.json');
  for (const file of pluginFiles) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (payload.mcpServers && typeof payload.mcpServers === 'object' && !Array.isArray(payload.mcpServers)) {
        Object.keys(payload.mcpServers).forEach(server => servers.add(server));
      }
    } catch {
      // Ignore malformed sample manifests during inventory.
    }
  }

  return [...servers].sort();
}

function lspServerCount(baseRoot, pluginFiles) {
  let count = collectFiles(baseRoot, ['.', 'plugin', 'plugins'], file => path.basename(file) === '.lsp.json' || path.basename(file) === 'lsp.json').length;
  for (const file of pluginFiles) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (payload.lspServers) count += typeof payload.lspServers === 'string' ? 1 : Object.keys(payload.lspServers || {}).length;
    } catch {
      // Ignore malformed sample manifests during inventory.
    }
  }
  return count;
}

function localPrimitiveEvidence(baseRoot) {
  const agents = collectFiles(baseRoot, ['plugin/agents', 'agents', '.github/agents'], file => file.endsWith('.agent.md') || file.endsWith('.agent'));
  const skills = collectFiles(baseRoot, ['plugin/skills', 'skills', '.github/skills'], file => path.basename(file) === 'SKILL.md');
  const hookFiles = collectFiles(baseRoot, ['.', 'plugin', 'hooks', '.github/hooks'], file => path.basename(file) === 'hooks.json');
  const mcpFiles = collectFiles(baseRoot, ['.', 'plugin', 'copilot', '.github'], file => path.basename(file) === '.mcp.json' || /^mcp.*\.json$/.test(path.basename(file)));
  const instructionFiles = collectFiles(baseRoot, ['.', '.github', '.github/instructions', 'instructions'], file => {
    const name = path.basename(file);
    return name === 'AGENTS.md' || name === 'copilot-instructions.md' || name.endsWith('.instructions.md');
  });
  const pluginFiles = collectFiles(baseRoot, ['.', 'plugin', 'plugins'], file => path.basename(file) === 'plugin.json');
  const workflowCommandFiles = collectFiles(baseRoot, ['workflows', 'commands', '.github/workflows'], file => file.endsWith('.md'));
  const benchmarkSuites = collectFiles(baseRoot, ['benchmarks'], file => path.basename(file) === 'suite.json');
  const hookEvents = countHookEvents(hookFiles);
  const mcpServers = mcpServerNames(baseRoot, mcpFiles);
  const lspCount = lspServerCount(baseRoot, pluginFiles);

  return {
    root: baseRoot,
    agents,
    skills,
    hookFiles,
    hookEvents: [...hookEvents].sort(),
    mcpFiles,
    mcpServers,
    instructionFiles,
    pluginFiles,
    workflowCommandFiles,
    benchmarkSuites,
    lspCount
  };
}

function primitiveStatus({ configured = 0, observedQuery = false, inferred = false }) {
  if (configured > 0) return 'configured';
  if (inferred) return 'inferred';
  if (observedQuery) return 'observed_query';
  return 'not_seen';
}

function primitiveRows(evidence) {
  const hookPolicyConfigured = evidence.hookEvents.includes('preToolUse') || evidence.hookEvents.includes('postToolUseFailure');
  const subagentHookConfigured = evidence.hookEvents.includes('subagentStop');
  const subagentHints = evidence.agents.filter(file => {
    const text = fs.readFileSync(file, 'utf8');
    return /\/fleet|subagent/i.test(text) || /tools:\s*(\[[^\]]*\bagent\b|.*\bagent\b)/i.test(text);
  });

  const rows = [
    {
      primitive: 'custom_agents',
      status: primitiveStatus({ configured: evidence.agents.length, observedQuery: true }),
      configured_count: evidence.agents.length,
      evidence: relativePaths(evidence.root, evidence.agents)
    },
    {
      primitive: 'subagents',
      status: primitiveStatus({ configured: subagentHookConfigured ? 1 : 0, observedQuery: true, inferred: subagentHints.length > 0 }),
      configured_count: subagentHookConfigured ? 1 : 0,
      evidence: subagentHookConfigured ? ['hook:subagentStop'] : relativePaths(evidence.root, subagentHints)
    },
    {
      primitive: 'skills',
      status: primitiveStatus({ configured: evidence.skills.length, observedQuery: true }),
      configured_count: evidence.skills.length,
      evidence: relativePaths(evidence.root, evidence.skills)
    },
    {
      primitive: 'hooks',
      status: primitiveStatus({ configured: evidence.hookFiles.length, observedQuery: true }),
      configured_count: evidence.hookFiles.length,
      evidence: evidence.hookEvents
    },
    {
      primitive: 'mcp_servers',
      status: primitiveStatus({ configured: evidence.mcpServers.length, observedQuery: true }),
      configured_count: evidence.mcpServers.length,
      evidence: evidence.mcpServers
    },
    {
      primitive: 'mcp_tools',
      status: primitiveStatus({ observedQuery: true }),
      configured_count: 0,
      evidence: ['runtime gen_ai.tool.name namespaced as mcp__server__tool or server/tool']
    },
    {
      primitive: 'built_in_tools',
      status: primitiveStatus({ observedQuery: true }),
      configured_count: 0,
      evidence: ['runtime execute_tool spans']
    },
    {
      primitive: 'instructions',
      status: primitiveStatus({ configured: evidence.instructionFiles.length }),
      configured_count: evidence.instructionFiles.length,
      evidence: relativePaths(evidence.root, evidence.instructionFiles)
    },
    {
      primitive: 'plugins',
      status: primitiveStatus({ configured: evidence.pluginFiles.length }),
      configured_count: evidence.pluginFiles.length,
      evidence: relativePaths(evidence.root, evidence.pluginFiles)
    },
    {
      primitive: 'workflows_commands',
      status: primitiveStatus({ configured: evidence.workflowCommandFiles.length }),
      configured_count: evidence.workflowCommandFiles.length,
      evidence: relativePaths(evidence.root, evidence.workflowCommandFiles)
    },
    {
      primitive: 'lsp_servers',
      status: primitiveStatus({ configured: evidence.lspCount }),
      configured_count: evidence.lspCount,
      evidence: evidence.lspCount > 0 ? ['plugin lspServers or lsp config file'] : []
    },
    {
      primitive: 'benchmarks',
      status: primitiveStatus({ configured: evidence.benchmarkSuites.length, observedQuery: true }),
      configured_count: evidence.benchmarkSuites.length,
      evidence: relativePaths(evidence.root, evidence.benchmarkSuites)
    },
    {
      primitive: 'acp',
      status: primitiveStatus({ observedQuery: true }),
      configured_count: 0,
      evidence: ['runtime agentops.cli.acp']
    },
    {
      primitive: 'attachments',
      status: primitiveStatus({ observedQuery: true }),
      configured_count: 0,
      evidence: ['runtime agentops.cli.attachment.count']
    },
    {
      primitive: 'policy',
      status: primitiveStatus({ configured: hookPolicyConfigured ? 1 : 0, observedQuery: true }),
      configured_count: hookPolicyConfigured ? 1 : 0,
      evidence: hookPolicyConfigured ? ['hook:preToolUse/postToolUseFailure'] : []
    },
    {
      primitive: 'context_events',
      status: primitiveStatus({ observedQuery: true }),
      configured_count: 0,
      evidence: ['runtime truncation, compaction, token pressure fields']
    }
  ];

  const byName = new Map(primitiveDefinitions);
  return rows.map(row => ({
    ...row,
    description: byName.get(row.primitive)
  }));
}

function createPrimitives({ root, workspaceId, kqlFileQuery, validateKqlDuration, optionValue }) {
  function copilotPrimitivesInventory(args = []) {
    const last = validateKqlDuration(optionValue(args, ['--last']) || '7d');
    const rootArg = optionValue(args, ['--root']);
    const scanRoot = rootArg ? path.resolve(rootArg) : root;
    const evidence = localPrimitiveEvidence(scanRoot);

    return {
      workspace_id: workspaceId,
      last,
      root: scanRoot,
      generated_at: new Date().toISOString(),
      primitives: primitiveRows(evidence),
      observed_query: kqlFileQuery('20-copilot-primitives-inventory.kql', last),
      status_legend: {
        configured: 'Found in local Copilot/plugin files.',
        observed_query: 'Not configured locally, but covered by runtime telemetry query.',
        inferred: 'Can be reconstructed when parent/child telemetry exists.',
        not_seen: 'No local config found and no dedicated runtime signal in this pack yet.'
      }
    };
  }

  return {
    copilotPrimitivesInventory
  };
}

module.exports = {
  createPrimitives
};
