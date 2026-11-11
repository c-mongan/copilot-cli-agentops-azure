# CI diagnosis observability with Pydantic AI and Logfire

A small, reproducible technical evaluation: can a developer follow a diagnosis,
separate a tool failure from invalid model output, and see missing evidence without
exporting prompts, tool responses or exception bodies?

**Status:** local end-to-end checks pass. Hosted Logfire ingestion has **not** been
verified. No Logfire credentials were available during development. GitHub OAuth
and an onboarding email are not ingestion evidence.

## Run locally (no credentials, no model API calls)

From this repository's root, with Python 3.11+ and [uv](https://docs.astral.sh/uv/):

```bash
cd examples/logfire-cicd
export UV_PROJECT_ENVIRONMENT="${TMPDIR:-/tmp}/agentops-logfire-cicd-venv"
uv sync --locked
uv run --locked pytest -q
uv run --locked python demo.py --output spans.json > summary.json
cat summary.json
```

Versions tested: Logfire 5.1.1, Pydantic AI slim 2.55.0, Python 3.12.14.
`uv.lock` pins transitive dependencies. This example has its own environment.
The environment lives outside the checkout because AgentOps’ repository audit
scans untracked files, including third-party package documentation.
GitHub Actions runs these checks on relevant PRs, main pushes and manual dispatch.
[Sample summary](sample/summary.json) and [27 sample spans](sample/spans.json)
are real local exports from a synthetic run; their IDs will change on rerun.

| Scenario | Expected result | What to inspect |
| --- | --- | --- |
| supported | `supported` | Two model calls around a successful evidence tool |
| missing-evidence | `needs_evidence` | Root missing count 1, missing ID `diff-001` |
| tool-failure | `tool_error` | `demo.fetch_evidence` ERROR, `TimeoutError`, domain `tool` |
| model-failure | `model_error` | Tool succeeds; invalid output fails schema validation, domain `model` |

Each case has one `demo.diagnosis` root. Beneath it: the reused AgentOps script
step, Pydantic AI agent run, model calls, and tool execution. The 20 ms evidence
lookup is simulated with an async delay; all recorded durations are measured.
The model-error case deliberately emits an invalid verdict with zero retries.
The tool-error case raises a real TimeoutError with a synthetic private sentinel.
All cases are handled, so deliberate failures do not make the local command fail.

This uses a **deterministic FunctionModel**, not a hosted LLM. Pydantic AI actually
executes the tool and validates typed output, but the diagnosis is scripted.
Any token counts emitted by FunctionModel are synthetic estimates, not provider
billing, real LLM latency, or evidence of diagnosis quality. The evidence fixture
contains a dependency conflict and version change; no Microsoft data is accessed.

## Export to your EU Logfire project (explicit opt-in)

Obtain a **project write token** for your personal EU `c-mongan/starter-project`
from Logfire's project settings. Account OAuth alone is insufficient. Keep the
token out of source, shell history, screenshots, application materials and chat.
For example, enter it privately in your own Bash terminal:

```bash
read -rs -p 'EU Logfire project write token: ' LOGFIRE_TOKEN
export LOGFIRE_TOKEN
printf '\n'
uv run --locked python demo.py --send --output spans.json > summary.json
unset LOGFIRE_TOKEN
cat summary.json
```

The destination is fixed to `https://logfire-eu.pydantic.dev/v1/traces`.
Without `--send`, even ambient Logfire tokens cannot enable remote export.
The SDK's default exporter is disabled; a standard OTel HTTP exporter receives
only sanitized spans. Remote export uses a simple processor for short-run
reliability. This can add network latency to a run, so use the local run to
explain simulated application timing. A batch processor would suit production.

`export_acknowledged_not_readback_verified` means the OTLP exporter reported
success, **not** that the traces have been inspected in Logfire. `export_failed`
returns exit code 1. The script never claims hosted readback verification.

To verify actual ingestion in the EU project:

1. Copy `run_id` from summary.json. In Live, select service
   `agentops-logfire-cicd-demo`; filter span attribute `demo.run_id` to that value.
2. Find the four diagnosis roots, match their trace IDs to summary.json, and open
   each trace. Child spans do not all carry `demo.run_id`; inspect the full trace.
3. Confirm the outcomes above, ERROR spans, parent relationships and timing.
4. Inspect attributes: no prompt/completion bodies, tool arguments/responses,
   exception messages/stack traces or sentinel string should be present.
5. Record UTC verification time, project, run ID, four trace IDs and the result.
   A screenshot or project trace link can support this **after** inspection;
   review access permissions before linking a private Logfire project publicly.

Until those steps are completed, describe this as locally validated with an
implemented EU export path, not a verified hosted Logfire integration.

## Privacy boundary and reuse

`ScriptObservation` is imported directly from
`instrumentation/python/agentops_script.py`; no observer source is copied.
It receives Logfire's OTel tracer instead of invoking `observe_script`, which
creates an independent provider. This preserves common physical parentage and
reuses its exception-type-only error behavior without changing core AgentOps.

Pydantic AI instrumentation explicitly disables content, binary content and
model request parameters. Framework spans can still contain exception events,
so `PublicExporter` constructs sanitized ReadableSpans **before both local and
remote export**: allowlisted attributes, no events, no links, no status description,
and a synthetic service resource without host metadata. No global HTTP, logging,
Pydantic validation or system instrumentation is enabled. Ambient OTLP exporter
settings are removed in this dedicated process, and sampling is fixed at 100%
so the four short traces are reproducible.

This is a focused synthetic fixture, not a general-purpose data-loss-prevention
filter. Do not wire it to real CI or arbitrary user-controlled attribute values.
It accepts no external prompts, log files or credentials other than the export
token. Tests examine real exported spans, sentinel exclusion, remote sanitization,
transport failure accounting, and ambient configuration isolation.

## Five-minute customer walkthrough

- **Problem:** a failed AI diagnosis does not tell you whether the model, evidence
  source, or application failed. A confident-looking answer may lack evidence.
- **Success criteria:** four connected traces; tool/model failures distinguishable;
  missing evidence visible; content excluded; hosted readback required separately.
- **Demo:** run locally, open the tool-error trace, compare the model-error trace,
  then show the missing-evidence root. The output gate refuses a supported verdict
  when the required diff is absent, or a reference to evidence it did not retrieve.
- **Trade-off:** metadata-only traces reduce exposure but omit the conversation
  body. Inspect synthetic local inputs when debugging content. This POC tests the
  observability contract, not model accuracy, real-provider errors or production SLOs.
- **Next evaluation:** connect one approved model using only synthetic fixtures;
  evaluate groundedness and abstention on labelled examples. Keep that separate
  from this deterministic integration demonstration.

Application-safe description: “I built a reproducible Pydantic AI/Logfire tracing
example on my AgentOps work, with synthetic CI evidence, separate tool and output
validation failures, and payload exclusion tests. Local checks pass; hosted
Logfire ingestion is pending authenticated verification.” Apply with the existing
AgentOps evidence if hosted verification is not ready; this demo is supplementary.

Official references consulted:
- [Pydantic AI Logfire integration](https://pydantic.dev/docs/ai/integrations/logfire/)
- [Logfire configuration](https://pydantic.dev/docs/logfire/manage/configuration/)
- [Pydantic AI FunctionModel](https://ai.pydantic.dev/api/models/function/)
- [Pre-Sales Solutions Engineer role](https://pydantic.dev/jobs/pre-sales-solutions-engineer)
