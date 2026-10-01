# Legacy tool names (provenance record only — not wired up)

These are the 12 tool names from the workshop's 2025-era `agents/before/tools.py`
(commit `0b445c70eccfe3814f7cbdcec59d5a8102e391f8`), recorded here only for
provenance/narrative continuity with the decomposition story. **None of
these are implemented as live Copilot CLI tools or an MCP server in this
fixture** — see `../../ATTRIBUTION.md`.

| Tool | Workshop smell it carries | What replaces it in the healthy fixture |
|---|---|---|
| `get_stock_level` | fine as-is | trivial CSV lookup via `bash`/`read` |
| `list_low_stock` | dumps the whole table into context | `forecasting/scripts/batch_days_of_cover.py` |
| `get_sales_velocity` | a tool for a mean | inline script computation |
| `forecast_demand` | delegates to a subagent that returns prose | `forecasting` skill, Path A/B |
| `get_supplier_catalog` | fine as-is | CSV read |
| `compare_supplier_quotes` | delegates arithmetic to a subagent | `supplier-selection` skill (code execution) — **planted-mechanical-llm-step reintroduces exactly this smell** |
| `create_purchase_order` | fine as-is | append to `sinks/purchase_orders.jsonl` |
| `update_erp_record` | fine as-is | append to `sinks/erp_writes.jsonl` |
| `send_slack_alert` | fine alone, but invites a per-SKU loop | `notify-templates` skill's "batch, don't spam" guidance — **planted-tool-thrash removes exactly this guidance** |
| `draft_email_to_supplier` | fine as-is | `notify-templates` skill |
| `generate_weekly_report` | is the report structure a skill or a tool? | `weekly-report` skill |
| `search_web_for_disruptions` | does this belong in this agent at all? | deliberately dropped — out of scope for a fixture-only, no-network agent |

A real pilot would need an actual "owned fixture MCP" server exposing
read-only queries over `fixtures/data/`, scoped narrowly (no write access to
anything outside `fixtures/sinks/`, no network). Building and running that
MCP server is a live-environment step this task does not perform (see the
scope boundary in the task report).
