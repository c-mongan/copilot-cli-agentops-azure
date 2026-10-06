# Bicep Errors

| Error | Resolution |
|-------|------------|
| Syntax error | `az bicep build` to check |
| Missing parameter | Add to parameters file |
| Invalid property | Check `mcp_bicep_get_az_resource_type_schema` |
| Resource conflict | Check existing resources |
| Deployment failed | `az deployment sub show --name <name>` |
| Permission denied | Verify RBAC roles |

## Cleanup (DESTRUCTIVE)

Do not run this without separate, explicit owner approval. First confirm the exact subscription and target, and confirm that a recovery path (backup or redeploy from source) exists. Preview what would be deleted before running anything.

```bash
az account show --query "{name:name,id:id}" -o table
az resource list -g <rg-name> -o table   # preview
az group delete --name <rg-name>         # prompts for confirmation; never add --yes
```

⚠️ Permanently deletes ALL resources in the group.
