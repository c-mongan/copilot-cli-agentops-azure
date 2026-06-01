function classifyMcpToolRisk(toolName = '') {
  const value = String(toolName).toLowerCase();
  if (/secret|credential|token|keychain|ssh|env/.test(value)) return 'secret-access';
  if (/rm|delete|destroy|drop|truncate|wipe|format|kill/.test(value)) return 'destructive';
  if (/shell|bash|zsh|powershell|terminal|exec|command|process/.test(value)) return 'shell';
  if (/write|edit|patch|save|create_file|replace/.test(value)) return 'write-file';
  if (/browser|playwright|click|navigate|screenshot/.test(value)) return 'browser-control';
  if (/http|fetch|curl|wget|network|request|api/.test(value)) return 'network';
  return 'read-only';
}

module.exports = {
  classifyMcpToolRisk
};
