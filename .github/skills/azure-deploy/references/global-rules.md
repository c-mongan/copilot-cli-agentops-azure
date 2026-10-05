# Azure authority boundaries

These rules govern this Azure workflow, not unrelated tasks or higher-priority
host instructions. Complete authorized local preparation and validation without
routine approval. A local file edit within the request is not a destructive
cloud action.

Read back the target subscription, environment, resource group, and region.
Reuse explicit authorization when the operation and target match. Ask only when
authority or the target is missing, or the action adds material cost, deletion,
access changes, or another unapproved effect. A default subscription is evidence,
not authorization. A new environment or resource group changes the target.

Before an unapproved cloud action, present the concrete changes, target,
validation, and recovery path. Deploy approval does not imply deletion of old
resources. Never expose secrets. Destructive operations require a recovery path
or explicit acceptance of the risk; do not re-ask for the same approved action.

Preserve existing user files and infrastructure. Do not delete project or
workspace directories. Run template initialization only in an empty/new
directory; migrate needed changes into existing projects without overwriting
unrelated work. Use the project's existing deployment tool and applicable recipe.
