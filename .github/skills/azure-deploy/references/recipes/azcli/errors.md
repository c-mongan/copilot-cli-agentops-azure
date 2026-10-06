# Azure CLI Errors

| Error | Resolution |
|-------|------------|
| Not authenticated | `az login` |
| Subscription not found | `az account list` |
| Deployment failed | `az deployment sub show --name <name>` |
| Template error | `az deployment sub validate` |
| Permission denied | Verify RBAC roles |
| Quota exceeded | Request increase or change region |

## Cleanup (DESTRUCTIVE)

Do not run this without separate, explicit owner approval. First confirm the exact subscription and target, and confirm that a recovery path (backup or redeploy from source) exists. Preview what would be deleted before running anything.

```bash
az account show --query "{name:name,id:id}" -o table
az resource list -g <rg-name> -o table   # preview
az group delete --name <rg-name>         # prompts for confirmation; never add --yes
```

⚠️ Permanently deletes ALL resources in the group.
