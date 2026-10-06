# Azure agent skills for contributors

These skills help coding agents work on this repository's Azure path: validate, deploy, diagnose, query and cost-check the AgentOps pilot. They are developer tooling only. They are not part of the AgentOps plugin (`plugin/skills/`) and are not shipped in any package.

| Skill | Use it for |
| --- | --- |
| `azure-validate` | Pre-deploy checks and `what-if` before any Azure write |
| `azure-deploy` | Running an approved Bicep deployment, such as `infra/bicep/enterprise-workbook.bicep` |
| `azure-diagnostics` | Ingestion, DCR/DCE and Log Analytics troubleshooting |
| `azure-kusto` | Writing and checking KQL against the `AgentOps*_CL` tables |
| `azure-cost` | Checking the pilot stays inside its budget |
| `azure-resource-lookup` | Read-only inventory of the pilot resource group |

## Repository guardrails (these override the skills)

- Never run `azd provision` or `azd up`. Use the additive enterprise route in [HANDOFF.md](../../HANDOFF.md) §4.
- Run `az deployment group what-if` first. Expect only the intended resource to change.
- Never delete Azure resources without a separate, explicit approval.
- Publish only synthetic, metadata-only fixtures during tests. Keep receipts and account data out of the repository.

## Provenance

Copied from [microsoft/azure-skills](https://github.com/microsoft/azure-skills) on 2026-10-04 (only CRLF line endings normalized to LF). MIT License; see [LICENSE-microsoft-azure-skills](LICENSE-microsoft-azure-skills). To update, re-copy the folders from upstream and re-check the guardrails above.
