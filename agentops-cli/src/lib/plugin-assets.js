const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { repoRoot } = require('./paths');

const root = repoRoot;

function parseFrontmatter(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const yaml = text.slice(3, end).trim();
  const data = {};

  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    data[match[1]] = value;
  }

  return data;
}

function defaultCopilotHome() {
  return process.env.AGENTOPS_COPILOT_HOME || process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
}

function listDefaultSkills(sourceDir = path.join(root, 'plugin', 'skills')) {
  if (!fs.existsSync(sourceDir)) return [];

  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const skillDir = path.join(sourceDir, entry.name);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) return null;
      const frontmatter = parseFrontmatter(skillFile);
      return {
        name: frontmatter.name || entry.name,
        directory: entry.name,
        description: frontmatter.description || '',
        source: skillFile
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function listDefaultAgents(sourceDir = path.join(root, 'plugin', 'agents')) {
  if (!fs.existsSync(sourceDir)) return [];

  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.agent.md'))
    .map(entry => {
      const agentFile = path.join(sourceDir, entry.name);
      const frontmatter = parseFrontmatter(agentFile);
      return {
        name: frontmatter.name || entry.name.replace(/\.agent\.md$/, ''),
        file: entry.name,
        description: frontmatter.description || '',
        source: agentFile
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function skillInstallTarget(options = {}) {
  const copilotHome = path.resolve(options.copilotHome || defaultCopilotHome());
  const targetDir = path.resolve(options.skillsDir || path.join(copilotHome, 'skills'));
  return { copilotHome, targetDir };
}

function agentInstallTarget(options = {}) {
  const copilotHome = path.resolve(options.copilotHome || defaultCopilotHome());
  const targetDir = path.resolve(options.agentsDir || path.join(copilotHome, 'agents'));
  return { copilotHome, targetDir };
}

function installDefaultSkills(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || path.join(root, 'plugin', 'skills'));
  const { copilotHome, targetDir } = skillInstallTarget(options);
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const skills = listDefaultSkills(sourceDir);
  const installedSkills = [];
  const updated = [];
  const skipped = [];

  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

  for (const skill of skills) {
    const sourceSkillDir = path.dirname(skill.source);
    const targetSkillDir = path.join(targetDir, skill.directory);
    const targetExists = fs.existsSync(targetSkillDir);

    if (targetExists && !force) {
      skipped.push({ name: skill.name, target: targetSkillDir, reason: 'exists' });
      continue;
    }

    if (!dryRun) {
      if (targetExists) fs.rmSync(targetSkillDir, { recursive: true, force: true });
      fs.cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
    }

    const record = { name: skill.name, target: targetSkillDir };
    if (targetExists) updated.push(record);
    else installedSkills.push(record);
  }

  return {
    copilotHome,
    targetDir,
    sourceDir,
    force,
    dryRun,
    skills,
    installed: installedSkills.length,
    installedSkills,
    updated,
    skipped
  };
}

function uninstallDefaultSkills(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || path.join(root, 'plugin', 'skills'));
  const { copilotHome, targetDir } = skillInstallTarget(options);
  const dryRun = Boolean(options.dryRun);
  const skills = listDefaultSkills(sourceDir);
  const removed = [];
  const missing = [];

  for (const skill of skills) {
    const targetSkillDir = path.join(targetDir, skill.directory);
    if (!fs.existsSync(targetSkillDir)) {
      missing.push({ name: skill.name, target: targetSkillDir });
      continue;
    }

    if (!dryRun) fs.rmSync(targetSkillDir, { recursive: true, force: true });
    removed.push({ name: skill.name, target: targetSkillDir });
  }

  return {
    copilotHome,
    targetDir,
    sourceDir,
    dryRun,
    skills,
    removed,
    missing
  };
}

function installDefaultAgents(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || path.join(root, 'plugin', 'agents'));
  const { copilotHome, targetDir } = agentInstallTarget(options);
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const agents = listDefaultAgents(sourceDir);
  const installedAgents = [];
  const updated = [];
  const skipped = [];

  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

  for (const agent of agents) {
    const targetFile = path.join(targetDir, agent.file);
    const targetExists = fs.existsSync(targetFile);

    if (targetExists && !force) {
      skipped.push({ name: agent.name, target: targetFile, reason: 'exists' });
      continue;
    }

    if (!dryRun) {
      fs.copyFileSync(agent.source, targetFile);
    }

    const record = { name: agent.name, target: targetFile };
    if (targetExists) updated.push(record);
    else installedAgents.push(record);
  }

  return {
    copilotHome,
    targetDir,
    sourceDir,
    force,
    dryRun,
    agents,
    installed: installedAgents.length,
    installedAgents,
    updated,
    skipped
  };
}

function uninstallDefaultAgents(options = {}) {
  const sourceDir = path.resolve(options.sourceDir || path.join(root, 'plugin', 'agents'));
  const { copilotHome, targetDir } = agentInstallTarget(options);
  const dryRun = Boolean(options.dryRun);
  const agents = listDefaultAgents(sourceDir);
  const removed = [];
  const missing = [];

  for (const agent of agents) {
    const targetFile = path.join(targetDir, agent.file);
    if (!fs.existsSync(targetFile)) {
      missing.push({ name: agent.name, target: targetFile });
      continue;
    }

    if (!dryRun) fs.rmSync(targetFile, { force: true });
    removed.push({ name: agent.name, target: targetFile });
  }

  return {
    copilotHome,
    targetDir,
    sourceDir,
    dryRun,
    agents,
    removed,
    missing
  };
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function renderSkillsInstall(result) {
  const lines = [
    `Installed AgentOps skills into ${result.targetDir}.`,
    `${plural(result.installed, 'new skill')}; ${plural(result.updated.length, 'updated skill')}; skipped ${plural(result.skipped.length, 'existing skill')}.`
  ];

  if (result.skills.length > 0) {
    lines.push('', 'Available skills:');
    for (const skill of result.skills) lines.push(`- ${skill.name}`);
    const starterSkill = result.skills.find(skill => skill.name === 'agentops-live-triage') || result.skills[0];
    lines.push('', `Ask Copilot: Use ${starterSkill.name} to inspect the latest AgentOps run.`);
  }

  if (result.skipped.length > 0) {
    lines.push('Run `agentops skills install --force` to refresh skipped skills from this repo.');
  }

  return `${lines.join('\n')}\n`;
}

function renderSkillsUninstall(result) {
  const lines = [
    `Removed AgentOps skills from ${result.targetDir}.`,
    `${plural(result.removed.length, 'skill')} removed; ${plural(result.missing.length, 'skill')} already absent.`
  ];
  return `${lines.join('\n')}\n`;
}

function renderAgentsInstall(result) {
  const lines = [
    `Installed AgentOps agents into ${result.targetDir}.`,
    `${plural(result.installed, 'new agent')}; ${plural(result.updated.length, 'updated agent')}; skipped ${plural(result.skipped.length, 'existing agent')}.`
  ];

  if (result.agents.length > 0) {
    lines.push('', 'Available agents:');
    for (const agent of result.agents) lines.push(`- ${agent.name}`);
    const starterAgent = result.agents.find(agent => agent.name === 'agentops-orchestrator') || result.agents[0];
    lines.push('', `Ask Copilot: Use ${starterAgent.name} to route my AgentOps question.`);
  }

  if (result.skipped.length > 0) {
    lines.push('Run `agentops agents install --force` to refresh skipped agents from this repo.');
  }

  return `${lines.join('\n')}\n`;
}

function renderAgentsUninstall(result) {
  const lines = [
    `Removed AgentOps agents from ${result.targetDir}.`,
    `${plural(result.removed.length, 'agent')} removed; ${plural(result.missing.length, 'agent')} already absent.`
  ];
  return `${lines.join('\n')}\n`;
}

function installPlugin(options = {}) {
  return {
    agents: installDefaultAgents(options),
    skills: installDefaultSkills(options)
  };
}

function uninstallPlugin(options = {}) {
  return {
    agents: uninstallDefaultAgents(options),
    skills: uninstallDefaultSkills(options)
  };
}

function renderPluginInstall(result) {
  const lines = [
    'Installed AgentOps Copilot plugin files.',
    `Agents: ${plural(result.agents.installed, 'new agent')}; ${plural(result.agents.updated.length, 'updated agent')}; skipped ${plural(result.agents.skipped.length, 'existing agent')}.`,
    `Skills: ${plural(result.skills.installed, 'new skill')}; ${plural(result.skills.updated.length, 'updated skill')}; skipped ${plural(result.skills.skipped.length, 'existing skill')}.`,
    '',
    'Ask Copilot: Use agentops-orchestrator to run the first read-only AgentOps check.',
    'Remove later with `agentops plugin uninstall`.'
  ];
  return `${lines.join('\n')}\n`;
}

function renderPluginUninstall(result) {
  const lines = [
    'Removed AgentOps Copilot plugin files.',
    `Agents: ${plural(result.agents.removed.length, 'agent')} removed; ${plural(result.agents.missing.length, 'agent')} already absent.`,
    `Skills: ${plural(result.skills.removed.length, 'skill')} removed; ${plural(result.skills.missing.length, 'skill')} already absent.`
  ];
  return `${lines.join('\n')}\n`;
}

module.exports = {
  agentInstallTarget,
  defaultCopilotHome,
  installDefaultAgents,
  installDefaultSkills,
  installPlugin,
  listDefaultAgents,
  listDefaultSkills,
  parseFrontmatter,
  plural,
  renderAgentsInstall,
  renderAgentsUninstall,
  renderPluginInstall,
  renderPluginUninstall,
  renderSkillsInstall,
  renderSkillsUninstall,
  skillInstallTarget,
  uninstallDefaultAgents,
  uninstallDefaultSkills,
  uninstallPlugin
};
