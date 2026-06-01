function classifyToolName(toolName = '') {
  const name = String(toolName).toLowerCase();
  if (/secret|credential|token|password|ssh|keychain/.test(name)) return 'secret-access';
  if (/rm|delete|destroy|drop|truncate|format/.test(name)) return 'destructive';
  if (/browser|playwright|selenium|chrom(e|ium)/.test(name)) return 'browser-control';
  if (/shell|bash|terminal|exec|command|npm|node|python|pytest|make/.test(name)) return 'shell';
  if (/write|edit|patch|apply|create_file|save/.test(name)) return 'write-file';
  if (/http|fetch|curl|wget|request|network|web/.test(name)) return 'network';
  return 'read-only';
}

function extractAllowedTools(args = []) {
  const tools = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--allow-tool') tools.push(args[index + 1] || '');
    if (arg.startsWith('--allow-tool=')) tools.push(arg.slice('--allow-tool='.length));
  }
  return tools.filter(Boolean).map(tool => ({
    name: tool,
    risk: classifyToolName(tool)
  }));
}

function summarizeAllowedTools(args = []) {
  const allowed = extractAllowedTools(args);
  const risks = allowed.reduce((counts, tool) => {
    counts[tool.risk] = (counts[tool.risk] || 0) + 1;
    return counts;
  }, {});
  return {
    count: allowed.length,
    tools: allowed,
    risks
  };
}

module.exports = {
  classifyToolName,
  extractAllowedTools,
  summarizeAllowedTools
};
