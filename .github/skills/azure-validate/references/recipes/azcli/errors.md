# AZCLI Validation Errors

| Error | Fix |
|-------|-----|
| `AADSTS700082: Token expired` | `az login` |
| `Please run 'az login'` | `az login` |
| `AADSTS50076: MFA required` | `az login --use-device-code` |
| `AuthorizationFailed` | Read the denied action and scope from the error, then request the narrowest built-in or custom role that grants it at the smallest scope. Do not default to Contributor. |
| `npm ci` fails with `missing: package-lock.json` | Run `npm install --package-lock-only` in the service directory before building |
| `Template validation failed` | Check Bicep syntax |

## Debug

```bash
az <command> --verbose --debug
```
