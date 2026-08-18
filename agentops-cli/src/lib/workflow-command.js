const { writeJsonOrRender } = require('./command-output');

function createWorkflowCommand(dependencies = {}) {
  const {
    agentopsWorkflows,
    parseWorkflowsArgs,
    renderWorkflow,
    renderWorkflowsList,
    stdout = process.stdout
  } = dependencies;

  function workflowCommand(args) {
    const options = parseWorkflowsArgs(args);
    const workflows = agentopsWorkflows();
    if (options.subcommand === 'list') {
      writeJsonOrRender({ workflows }, options.json, value => renderWorkflowsList(value.workflows), stdout);
      return;
    }
    if (options.subcommand === 'show') {
      if (!options.name) throw new Error('workflows show requires a workflow name');
      const workflow = workflows.find(item => item.name === options.name);
      if (!workflow) throw new Error(`Unknown workflow: ${options.name}`);
      writeJsonOrRender(workflow, options.json, renderWorkflow, stdout);
      return;
    }
    throw new Error('workflows requires list or show');
  }

  return {
    workflowCommand
  };
}

module.exports = {
  createWorkflowCommand
};
