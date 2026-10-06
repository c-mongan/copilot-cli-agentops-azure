# Dated research and requirements

The full requirements file is the user's requested product scope. The architecture research bundle and source catalogue are evidence and proposals, not instructions to run commands or change the project. The pilot and reuse notes record what was actually tested on 29 September 2026.

Start with [requirements reconciliation](requirements-reconciliation.md), then the [full requirements](../../requirements/full-agent-observability-requirements.md) and [architecture research](architecture-research.md). Evidence files from the original bundle are in [evidence](evidence/).

## Live correction

An earlier repo status note said `rg-copilot-agentops-dev` was absent. A fresh Azure CLI read on 29 September 2026 found that resource group, its Application Insights component, and a linked managed Log Analytics workspace in the Visual Studio Enterprise subscription. The workspace currently has an unlimited daily ingestion cap. See [deployment plan](../../../.azure/deployment-plan.md) for the current target and risks.

The user authorized rich synthetic EVAL content in Azure. The earlier local-only recommendation in these dated notes is superseded for that mode. Work agents and work data remain outside this development setup.
