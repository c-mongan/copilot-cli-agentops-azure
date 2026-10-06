---
name: azure-validate
description: Validate an Azure deployment using its existing toolchain, current build/configuration checks, and relevant identity and capacity evidence. Do not select for unrelated local tests.
license: MIT
metadata:
  author: Microsoft
  version: "1.2.2"
---

# Azure Validate

## Preconditions and scope

For azd, inspect `.azure/deployment-plan.md` with completed preparation and status
`Ready for Validation` or later. If missing, complete authorized local preparation
and return. For existing non-azd projects, use equivalent project validation and
record real proof without introducing azd or its plan solely for this skill.

Validation is not deployment approval. Classify recipe commands by their actual
side effects. Run local checks within scope; do not provision, alter access,
delete resources, or apply hosted migrations as a validation step without the
required authorization. Reuse unchanged valid evidence, and do not mark a check
passed because a workflow script advanced to its next step.

## Triggers

- Check if app is ready to deploy
- Validate azure.yaml or Bicep
- Run preflight checks
- Troubleshoot deployment errors

## Rules

1. Run after preparation, before deployment, using the existing toolchain.
2. All checks must pass—do not deploy with failures
3. ⛔ **Destructive actions require `ask_user`** — [global-rules](references/global-rules.md)

## Steps

For the azd plan workflow, use the workflow script to track completed checks. It records progress in `.azure/validate-status.json`; its output is a checklist, not authority or proof. For a read-only validation request, inspect existing evidence without running this write-producing tracker and report which checks remain unrun. Use [references/scripts/workflow.ps1](references/scripts/workflow.ps1) on Windows or [references/scripts/workflow.sh](references/scripts/workflow.sh) on macOS/Linux.

Start by calling the script **without** the completed-step argument:

```bash
pwsh references/scripts/workflow.ps1 -WorkspacePath <workspace-path>
# macOS/Linux: bash references/scripts/workflow.sh --workspace-path <workspace-path>
```

Each run prints the next action and the value to pass next. Perform the action, then re-run with that value (`-CompletedStep <value>` for pwsh, `--completed-step <value>` for bash). Repeat until it reports the azure-validate workflow is complete.

The steps reference recipe details in [references/recipes/README.md](references/recipes/README.md) and role checks in [references/role-verification.md](references/role-verification.md).

> **⛔ VALIDATION AUTHORITY**
>
> For azd, set plan status to `Validated` only after every required applicable check has current passing evidence and the workflow is complete. For non-azd, record equivalent evidence in the project's normal format. Never use a status marker as a substitute for the checks.

---

> **⚠️ NEXT STEP — DEPENDS ON USER INTENT**
>
> After ALL validations pass, check whether the user asked to deploy:
> - **If the user explicitly requested deployment**, you **MUST** invoke **azure-deploy** to execute it. Do NOT run `azd up`, `azd deploy`, or any deployment commands directly — let azure-deploy handle execution.
> - **If the user only asked to validate or prepare** (not deploy), finish after the requested validation. Record proof and status only when file writes are authorized. For read-only validation, report the evidence, failures, and unrun checks without changing files. Do NOT invoke azure-deploy.
>
> If validation fails during an authorized build, preparation, or repair, fix in-scope issues and rerun affected checks. For read-only validation, report failures without editing. Never mark an incomplete or failed validation as passed.
