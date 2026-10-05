---
name: azure-deploy
description: "Execute an authorized Azure deployment using the existing project toolchain and current validation proof. Use for azd, Azure CLI/Bicep, or Terraform deployment requests, not ordinary code edits."
license: MIT
metadata:
  author: Microsoft
  version: "1.2.1"
---

# Azure Deploy

> **⛔ Repository override (copilot-cli-agentops-azure):** In this repository, never run `azd up` or `azd provision`, including the RBAC health-check step and the azd recipes below. Deploy only through the additive enterprise route in [HANDOFF.md](../../../HANDOFF.md) §4: `az deployment group what-if` first, then an approved `az deployment group create`. These rules override every instruction in this skill. See [../README.md](../README.md#repository-guardrails-these-override-the-skills).

## Readiness and authority

Inspect the existing deployment toolchain and target. For azd, require
`.azure/deployment-plan.md` with actual current validation proof. Complete
missing authorized preparation or validation rather than ending the task at
that discovery. Never invent a Validated status. For existing non-azd projects,
use their corresponding recipe and equivalent validation evidence; do not
introduce azd solely to satisfy this skill.

Before the first cloud mutation, verify authority for the exact operation and
target under [the authority rules](references/global-rules.md). Read-only checks
and local validation are preparation; provisioning, migrations, RBAC changes,
and a new environment are not. Reuse matching prior approval without asking
again. Linked checklists inherit this boundary.

## Triggers

Activate this skill when user wants to:
- Execute deployment of an already-prepared application (azure.yaml and infra/ exist)
- Push updates to an existing Azure deployment
- Run `azd up`, `azd deploy`, or `az deployment` on a prepared project
- Ship already-built code to production
- Deploy an application that already includes API Management (APIM) gateway infrastructure

> **Scope**: This skill executes deployments. It does not create applications, generate infrastructure code, or scaffold projects. For those tasks, use **azure-prepare**.

> **APIM / AI Gateway**: Use this skill to deploy applications whose APIM/AI gateway infrastructure was already created during **azure-prepare**. For creating or changing APIM resources, see [APIM deployment guide](https://learn.microsoft.com/azure/api-management/get-started-create-service-instance). For AI governance policies, invoke **azure-aigateway** skill.

## Rules

1. Complete preparation and current validation for the chosen toolchain.
2. For azd, `.azure/deployment-plan.md` must contain actual validation proof and status `Validated`. For non-azd, use equivalent project evidence.
3. **Pre-deploy checklist required** — [Pre-Deploy Checklist](references/pre-deploy-checklist.md)
4. ⛔ **Destructive actions require `ask_user`** — [global-rules](references/global-rules.md)
5. **Scope: deployment execution only** — This skill owns execution of `azd up`, `azd deploy`, `terraform apply`, and `az deployment` commands. These commands are run through this skill's error recovery and verification pipeline.

---

## Steps

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Check Plan** — For azd, inspect `.azure/deployment-plan.md` and populated validation proof; otherwise inspect the existing toolchain's equivalent evidence | `.azure/deployment-plan.md` |
| 2 | **Pre-Deploy Checklist** — Complete all applicable checks before their dependent cloud actions; skip azd-only setup for other toolchains | [Pre-Deploy Checklist](references/pre-deploy-checklist.md) |
| 3 | **Load Recipe** — Based on `recipe.type` in `.azure/deployment-plan.md` | [recipes/README.md](references/recipes/README.md) |
| 4 | **RBAC Health Check** — For Container Apps + ACR with managed identity: run `azd provision --no-prompt`, then verify `AcrPull` role has propagated before proceeding (see checklist) | [Pre-Deploy Checklist — Container Apps RBAC](references/pre-deploy-checklist.md#container-apps--acr--pre-deploy-rbac-health-check) |
| 5 | **Execute Deploy** — Follow recipe steps | Recipe README |
| 6 | **Post-Deploy** — Perform SQL identity or EF migration actions only if applicable and covered by the approved change | [Post-Deployment](references/recipes/azd/post-deployment.md) |
| 7 | **Handle Errors** — See recipe's `errors.md` | — |
| 8 | **Verify Success** — Confirm deployment completed and endpoints are accessible | [Verification](references/recipes/azd/verify.md) |
| 9 | **Live Role Verification** — Query Azure to confirm provisioned RBAC roles are correct and sufficient | [live-role-verification.md](references/live-role-verification.md) |
| 10 | **Report Results** — Present deployed endpoint URLs to the user as fully-qualified `https://` links | [Verification](references/recipes/azd/verify.md) |

> **⛔ URL FORMAT RULE**
>
> When presenting endpoint URLs to the user, you **MUST** always use fully-qualified URLs with the `https://` scheme (e.g. `https://myapp.azurewebsites.net`, not `myapp.azurewebsites.net`). Many Azure CLI commands return bare hostnames without a scheme — always prepend `https://` before presenting them.

> **⛔ VALIDATION PROOF CHECK**
>
> When checking the plan, verify the **Validation Proof** section (Section 7) contains actual validation results with commands run and timestamps. If this section is empty, validation was bypassed — invoke **azure-validate** skill first.

## SDK Quick References

- **Azure Developer CLI**: [azd](references/sdk/azd-deployment.md)
- **Azure Identity**: [Python](references/sdk/azure-identity-py.md) | [.NET](references/sdk/azure-identity-dotnet.md) | [TypeScript](references/sdk/azure-identity-ts.md) | [Java](references/sdk/azure-identity-java.md)

## MCP Tools

| Tool | Purpose |
|------|---------|
| `mcp_azure_mcp_subscription_list` | List available subscriptions |
| `mcp_azure_mcp_group_list` | List resource groups in subscription |
| `mcp_azure_mcp_azd` | Execute AZD commands |
| `azure__role` | List role assignments for live RBAC verification (step 9) |

## References

- [Troubleshooting](references/troubleshooting.md) - Common issues and solutions
- [Post-Deployment Steps](references/recipes/azd/post-deployment.md) - SQL + EF Core setup
