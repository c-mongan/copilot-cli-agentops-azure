# Lean enterprise implementation and pilot rollout — 2 October 2026

The user approved carrying the reviewed lean enterprise plan through implementation and deployment with “do it all”. Production target selection remains pending; qualify the existing development/test pilot without switching to Pay-As-You-Go.

1. Implement additive existing-workspace Bicep, metadata-only Workbook, bounded publishing/backlog controls and exact typed readback tooling.
2. Independently review security and data contracts; repair reproducible findings before uploads.
3. Verify exact subscription/RG/region, current included-usage protection, positive credit, access mode, role definitions and current schemas. Compile, ARM validate and inspect what-if.
4. Deploy reviewed Workbook and EUR 10 monthly budget into the existing North Europe synthetic pilot. Unknown principals and contacts remain omitted; no new paid runtime, public endpoint, content grant or original-service rebind.
5. Qualify a single <=1MiB synthetic producer batch through approved metadata streams, retain API acceptance and separate all-field cloud readback, then open and exercise the actual saved Workbook.
6. Complete current-source tests, installed-package checks, static contracts and independent final review. Preserve existing work and report cloud/live/human proof separately.

## Acceptance ledger

- Azure exposes the existing VS subscription and a separate PAYG subscription. Only the existing pilot is used here; VS is development/testing only.
- Fresh ARM spending limit is On; native portal independently confirms positive current-period credit. Private financial amounts are not published in this document.
- Existing pilot LAW/DCR/DCE/App Insights identity and schemas read back. Budget currency confirmed EUR. MFA-required write policy is present.
- New Bicep compiles; final ARM validation succeeds. What-if shows only two creates (Workbook and budget), no modifies/deletes; existing resources are Ignore.
- Workbook twelve panel queries and RunId selector pass actual bounded Azure KQL qualification. Empty successful queries stay unknown.
- Reader design corrected to workspace-scoped conditional data access. Deployment access guard rejects team grants under current resource-permissions access mode. Empty owner-only qualification grants no new principal rights and does not prove team isolation.
- Transport and qualification security review identified endpoint, conservative wire accounting, spool provenance and incomplete-readback issues. All repairs passed independent recheck before upload.
- Cloud deployment succeeded using reviewed exact ARM artifacts and owner-only parameters. Resource readback confirms the EUR 10 budget and exact maintained Workbook source; the actual portal now renders twelve panels and exercises run/time filters.

- One synthetic batch: all eleven stream uploads accepted, all 97 rows observed exactly through the typed API with every maintained field and canary absence checked. No batch reupload.
- Final CLI: 1,027 passed, one Windows skip; 90.51% line coverage. Enterprise scripts: 12 passed. Current installed-package smoke and 1,027-file static check passed. Independent final integration review approved.
- Full receipts and proof limits: [enterprise deployment verification](../research/2026-10-02-enterprise-deployment-verification.md).
