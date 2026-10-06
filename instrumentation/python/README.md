# Skill-script tracing

`agentops attach --repo . --yes` records hashes for discovered agents, skills, references, and supported Python/JavaScript/TypeScript source files across the repository, without copying their contents. Dependency/build directories such as `node_modules`, `vendor`, `dist`, `build`, and virtual environments are excluded. On an explicit `agentops copilot ...` launch from that attached repo, AgentOps adds a process-scoped Python startup hook. It emits a root span only when the running `.py` or `.pyw` file is listed in the attachment inventory and still matches the recorded hash. Ordinary `copilot`, Python runs outside the opted-in process, unlisted files, oversized unhashable files, and changed scripts do not emit these spans. No repository script is rewritten.

The automatic root span works with the Python standard library and does not require installing packages in the user's Python environment. When the OpenTelemetry SDK and OTLP/HTTP exporter are available, AgentOps uses them. Otherwise, a small built-in OTLP/HTTP protobuf exporter records the same root and named-step spans. Export failures are fail-open and do not change script behavior. Content fields are not exported. The attach preview reports how many discovered scripts were small enough to hash and are eligible for tracing.

For important internal operations, the existing helper can add named steps. Importing it during an ordinary run does not require OTel packages and does not export anything.

No Python package installation is needed. If the project already uses the OpenTelemetry SDK, `requirements.txt` lists the supported SDK/exporter versions. Add bounded steps to scripts where they explain meaningful work:

```python
from agentops_script import observe_script

with observe_script("my-skill/scripts/answer.py") as observation:
    with observation.step("parse"):
        # Existing script work.
        pass
    with observation.step("validate"):
        pass
```

The explicit Copilot launcher passes a unique `AGENTOPS_RUN_ID`, the Collector traces endpoint, and the attached inventory to subprocesses for that run. It injects the Python bootstrap directory through that process's `PYTHONPATH`; no user shell configuration is changed. Copilot's native OTel exporter supplies CLI spans while the script exporter supplies Python spans. These exporters are separate; pass both receipts to `agentops copilot-session view` with repeated `--otel-file` and `--run-id <id>`. The session reader supports Copilot span JSON, OTLP JSON, and OTLP protobuf receipts and preserves cross-process script events as logical run links unless trace context proves a physical parent.

The shared run ID proves that the script and Copilot spans came from the same opted-in launch. It does **not** prove that a particular Copilot tool call was the script's parent. The viewer labels this as a logical link. If a valid W3C `TRACEPARENT` is present in the script environment, the helper continues it; otherwise it starts a new trace. It never invents a parent from timestamps or file paths.

Invalid telemetry settings produce a short stderr diagnostic and leave script work running. Explicit contexts and the legacy startup hook record an exception type without its message; the supervisor records only `ProcessExit` or `ProcessSignal`. The startup hook creates a process root span; it does not infer function calls or internal steps. Add named steps where they answer a real debugging question. Node scripts receive the same repo-wide manifest-hash-gated automatic root span through `instrumentation/node/preload.cjs`; named Node steps use `instrumentation/node/agentops-script.cjs`. TypeScript support depends on the runtime launching the inventoried file directly; other loader modes remain to be tested. A fresh attached Copilot CLI run proved Python standard-library fallback spans, and Azure readback confirmed the root and skill Python script links. Enterprise readiness gates remain open.

For a direct `python owned-script.py ...` or `python3 owned-script.py ...`
command, the observed process receives a private PATH shim. The shim resolves
the real interpreter before changing PATH, starts the unchanged script as a
child with the same arguments, working directory, standard streams, environment,
and real `sys.executable`, then waits for its actual result. The supervisor root
span records bounded scalar metadata only: outcome source, separate observer and
child PIDs, and the actual exit code or signal number. A nonzero result is failed;
exit zero is successful. Exception and `SystemExit` messages are never copied
into telemetry. The owning shell event remains the exported source for the exact
shell exit code, while the span export uses its existing Outcome and ErrorType
fields.

SIGINT, SIGTERM, and SIGHUP are forwarded to the child. If the child handles the
signal and exits normally, that exit code is preserved. If it terminates from a
signal, the supervisor terminates with the same signal after exporting. A child
that does not stop within two seconds after a forwarded signal is killed and the
supervisor reports that actual kill signal. This bounds cancellation cleanup and
prevents an owned child from being left behind.

Interpreter forms that cannot be wrapped without changing Python semantics stay
outside this exact-outcome contract: absolute interpreter paths, options before
the script, `-m`, `-c`, stdin, and interactive mode. An inventoried file reached
through one of those forms may still get the older `sitecustomize` root, whose
outcome remains explicitly unknown unless an uncaught ordinary exception reaches
`sys.excepthook`; otherwise it is unobserved. Missing `python` or `python3`
commands are not added to PATH. Unowned and changed scripts pass through without
a fabricated span.

Explicit `observe_script` contexts and named internal steps in the child still
emit spans under the same run ID. They remain a separate process trace and are a
logical run link; the launcher does not invent physical parentage across the
process boundary. No global Python configuration, user shell file, tracing hook,
or debugger hook is installed.
