# Current-source local product browser verification

Date: 2026-10-02. Evidence tier: **synthetic fixture and local rendered UI only**.
No model invocation, personal browser profile, external network, cloud upload,
production change, commit, or causal outcome trial was performed.

## Build and isolation

The real CLI `agentops-cli/src/index.js product build` generated new external
output directories from an owner-only synthetic recorder-layout ledger. The
fixture follows `product-command-integration.test.js`, adds a synthetic native
session and native response span, and supplies one stored inconclusive experiment.
The fixture deliberately requests `mini` and records native actual response
`cloud5.5` with provider `github`; these are test data, not execution proof.
Raw payloads contain `PRIVATE_CANARY_BROWSER_VERIFY` to test exclusion.

SanDisk UUID and capacity were verified through `agent-storage status`; build
commands ran through `agent-storage run`. Base artifact directory:
`/Volumes/SanDisk Archive/Agent-Workspace/scratch/browser-product-20261002-verify`.
The CLI receipt reports `localEvidence: generated`, `cloudDelivery: pending`, and
`outcomes: unknown: no verified evaluation receipt`.

Browser: agent-browser 0.37.1, axe-core 4.12.1, isolated named session
`build-browser-2f68cbc4acae`, scratch empty configuration, loopback allowlist.
The first launch rejected inherited `AGENT_BROWSER_PROFILE=Profile 2` before
navigation; subsequent launches explicitly unset it and never attached to the
personal browser. Reports were served only at `127.0.0.1:18763`.

## Verified behavior

| Flow | Rendered and interaction proof |
| --- | --- |
| Index | Local/cloud boundaries and product/evidence links render; one main landmark after repair. |
| Runs | Search hides and restores the fixture card. Enter expands event evidence. Requested/actual/provider columns retain separate values. Unknown capture, identity, coverage and token values remain explicit. An event hash clears search, restores the card and opens evidence. |
| Replay | Launcher request `mini`, producer request/actual `cloud5.5`, provider `github` and reconciliation conflict render separately. Search, Failures, Tools, keyboard expansion and hash restoration work. Expanded metadata replaces private tool arguments/results. Missing token measurements and unsupported coverage denominators remain unknown/not tracked. |
| Architecture | Empty synthetic inventory produces insufficient evidence/no hypotheses, not an absence verdict. Search accepts input without inventing findings. |
| Compare | Stored synthetic decision remains inconclusive; missing configuration and protected execution do not support efficiency claims. Search/outcome filters hide and restore the card. Its run link resolves to the Runs anchor. |

Screenshots were captured and visually inspected at desktop 1440 × 1000 and
mobile 390 × 844. No document-level horizontal overflow was observed. The
metadata canary was absent from every generated product-v1 file and from the
rendered DOM of all ten desktop/mobile page states.

## Repairs and accessibility

Initial product index had no main landmark and failed `landmark-one-main` and
`region`. Its source owner added a main landmark, viewport and inline favicon;
fresh product-v2 passes the default axe audit, including best-practice rules.

Initial mobile Runs event columns collapsed into nearly one-character lines.
Its source owner gave the event table readable minimum widths within the
existing horizontal scroll container; Compare remains separate. The readable
scroll container then exposed `scrollable-region-focusable`. The owner added
`tabindex="0"`, a region role and an accessible label. Fresh product-v3 has zero
axe violations on Runs at both sizes. Focus plus ArrowRight moves the actual
horizontal scroll position at both desktop and mobile sizes. The model/provider
columns were visually inspected after scrolling.

The product-v2 default axe audit has zero violations and zero incomplete checks
for Index, Replay, Architecture and Compare at both sizes. Product-v3 Runs has
zero violations at both sizes. Its incomplete color-contrast result concerns offscreen
clipped table columns, not a measured failure. Computed table/caption foreground
is rgb(232, 238, 248) on article background rgb(25, 38, 58), giving 13.06:1
contrast; this was manually checked.

The fresh product-v2 browser session recorded no console messages or page errors;
network receipts contain only loopback document requests with HTTP 200.
Initial product-v1 had one favicon HTTP 404, repaired in product-v2.

Machine-readable audit files and screenshots are retained in the artifact base:
`summary-v1.json`, `summary-v2.json`, `summary-v3.json`, `v2-*-axe.json`,
`v3-*-axe.json`, `v2-desktop-*.png`, `v2-mobile-*.png`,
`v2-mobile-replay-expanded.png`, `v3-mobile-runs-model-columns.png`, and
`source-sha256.txt`. All three product builds are retained separately;
current-source repairs do not alter earlier evidence. Unchanged pages reuse
product-v2 visual/audit results; the repaired Runs flow was rebuilt and retested
in product-v3.

## Limits

This checks the implemented local UI and explicit unknown/inconclusive states.
It does not qualify live Copilot model selection, exhaustive instrumentation,
protected experiment results, customer outcomes, cloud delivery, or Azure
readback. Architecture search was checked in its empty state; no populated
hypothesis corpus or accepted protected comparison was fabricated.
