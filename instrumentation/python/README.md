# Python skill-script tracing pilot

`agentops_script.py` records a script root span and named internal steps with the OpenTelemetry Python SDK. It is an opt-in helper for **owned** Python scripts. Importing it during an ordinary run does not require OTel packages and does not export anything.

Install `requirements.txt` into the Python environment that executes the skill script. Put this directory on that process's `PYTHONPATH`, then add bounded spans to the script:

```python
from agentops_script import observe_script

with observe_script("my-skill/scripts/answer.py") as observation:
    with observation.step("parse"):
        # Existing script work.
        pass
    with observation.step("validate"):
        pass
```

For an observed Copilot CLI process, set a unique `AGENTOPS_RUN_ID` and `OTEL_RESOURCE_ATTRIBUTES=agentops.run.id=<same-id>` on **that process only**. Set `AGENTOPS_SCRIPT_OTLP_ENDPOINT` to an HTTPS Collector traces endpoint or a loopback HTTP traces endpoint. The Python process must inherit `AGENTOPS_RUN_ID`, `AGENTOPS_SCRIPT_OTLP_ENDPOINT`, and `PYTHONPATH`. Use Copilot's native OTel file exporter or its own HTTPS OTLP exporter for the CLI spans. These exporters are separate; pass both receipts to `agentops copilot-session view` with repeated `--otel-file` and `--run-id <id>`.

The shared run ID proves that the script and Copilot spans came from the same opted-in launch. It does **not** prove that a particular Copilot tool call was the script's parent. The viewer labels this as a logical link. If a valid W3C `TRACEPARENT` is actually present in the script environment, the helper continues it; otherwise it starts a new trace. It never invents a parent from timestamps or file paths.

When observation is off, the helper is a no-op. Invalid telemetry settings or missing OTel packages produce a short stderr diagnostic and leave script work running. Error spans contain the exception type, not the exception message. The helper does not automatically trace arbitrary Python functions; add named steps where they answer a real debugging question. Project setup and clean removal across all owned scripts remain future work.
