# Copilot instructions

This repository ships Copilot AgentOps: a CLI, a VS Code extension, an OTel Collector config, and Azure resources (Log Analytics, DCR/DCE, a Workbook).

## Review priorities

1. **Privacy first.** Telemetry is metadata-only by default. Flag any change that could export prompt text, completions, file contents, tool arguments, tokens, keys, or account identifiers. Strict privacy mode and the collector redaction/poison tests must keep passing.
2. **No secrets or receipts in the repo.** Flag committed subscription data, connection strings, workspace keys, run receipts, or personal paths.
3. **Azure safety.** Bicep changes should be incremental and scoped. Flag anything that deletes resources, widens RBAC, or makes public network access the default.
4. **Workbook KQL.** Insert `{TimeRange:start}`, `{TimeRange:end}` and `{TimeRange:grain}` unwrapped. Queries must tolerate missing custom tables and empty results.
5. **Correctness over style.** Prioritise bugs, data accuracy, and missing regression tests. Follow the existing conventions instead of suggesting broad refactors.

## Checks

- `npm --prefix agentops-cli test`
- `node scripts/run-native-tests.js`
- `npm --prefix agentops-cli run static:check`
- `node scripts/check-enterprise-iac.js`
- `node scripts/check-enterprise-workbook.js`
