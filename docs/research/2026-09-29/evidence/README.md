# Agent observability architecture research

Research date: 29 September 2026.

Start with `../architecture-research.md`. It contains the source-backed research, proposed design, capability boundaries, and remaining runtime experiments. No observability system had been implemented or deployed by the original research bundle.

## Evidence

- `source-catalogue.json`: the report's linked source catalogue.
- `trace-context-probe.py`: the bounded local Python/OpenTelemetry process-boundary experiment. Run with Python and `opentelemetry-sdk` installed. The original environment used OpenTelemetry SDK 1.42.1.
- `trace-context-probe.json`: the original observed result.
- `trace-context-probe-recheck.json`: an independent rerun during final validation; random trace and span IDs naturally differ.
- `validation.json`: report structure, internal source-reference, table-format, SHA-256, and fresh probe checks. This is not a fresh network check of every source URL.

The generic process experiment does not establish whether Copilot injects trace context into arbitrary shell subprocesses. Actual Copilot CLI, VS Code, and authenticated Azure end-to-end tests were not run; the report identifies them explicitly.
