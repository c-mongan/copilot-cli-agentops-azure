const { writeJson, writeJsonOrRender } = require('./command-output');

const pluginAssetCommandNames = Object.freeze(['plugin', 'agents', 'skills']);

function createPluginAssetCommand(dependencies = {}) {
  const {
    agentInstallTarget,
    installDefaultAgents,
    installDefaultSkills,
    installPlugin,
    listDefaultAgents,
    listDefaultSkills,
    parseSkillsArgs,
    renderAgentsInstall,
    renderAgentsUninstall,
    renderPluginInstall,
    renderPluginUninstall,
    renderSkillsInstall,
    renderSkillsUninstall,
    skillInstallTarget,
    stdout = process.stdout,
    uninstallDefaultAgents,
    uninstallDefaultSkills,
    uninstallPlugin
  } = dependencies;

  function pluginCommand(args) {
    const options = parseSkillsArgs(args);
    if (options.subcommand === 'install') {
      const result = installPlugin(options);
      writeJsonOrRender(result, options.json, renderPluginInstall, stdout);
      return;
    }
    if (options.subcommand === 'uninstall' || options.subcommand === 'remove') {
      const result = uninstallPlugin(options);
      writeJsonOrRender(result, options.json, renderPluginUninstall, stdout);
      return;
    }
    throw new Error('plugin requires install or uninstall');
  }

  function agentsCommand(args) {
    const options = parseSkillsArgs(args);
    if (options.subcommand === 'list') {
      writeJson({ agents: listDefaultAgents() }, stdout);
      return;
    }
    if (options.subcommand === 'path') {
      stdout.write(`${agentInstallTarget(options).targetDir}\n`);
      return;
    }
    if (options.subcommand === 'install') {
      const result = installDefaultAgents(options);
      writeJsonOrRender(result, options.json, renderAgentsInstall, stdout);
      return;
    }
    if (options.subcommand === 'uninstall' || options.subcommand === 'remove') {
      const result = uninstallDefaultAgents(options);
      writeJsonOrRender(result, options.json, renderAgentsUninstall, stdout);
      return;
    }
    throw new Error('agents requires list, path, install, or uninstall');
  }

  function skillsCommand(args) {
    const options = parseSkillsArgs(args);
    if (options.subcommand === 'list') {
      writeJson({ skills: listDefaultSkills() }, stdout);
      return;
    }
    if (options.subcommand === 'path') {
      stdout.write(`${skillInstallTarget(options).targetDir}\n`);
      return;
    }
    if (options.subcommand === 'install') {
      const result = installDefaultSkills(options);
      writeJsonOrRender(result, options.json, renderSkillsInstall, stdout);
      return;
    }
    if (options.subcommand === 'uninstall' || options.subcommand === 'remove') {
      const result = uninstallDefaultSkills(options);
      writeJsonOrRender(result, options.json, renderSkillsUninstall, stdout);
      return;
    }
    throw new Error('skills requires list, path, install, or uninstall');
  }

  function pluginAssetCommand(command, args) {
    if (command === 'plugin') {
      pluginCommand(args);
      return;
    }
    if (command === 'agents') {
      agentsCommand(args);
      return;
    }
    if (command === 'skills') {
      skillsCommand(args);
      return;
    }
    throw new Error(`Unknown plugin asset command: ${command}`);
  }

  return {
    pluginAssetCommand,
    pluginAssetCommandNames
  };
}

module.exports = {
  createPluginAssetCommand
};
