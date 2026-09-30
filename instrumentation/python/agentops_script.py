"""Opt-in OpenTelemetry spans for owned Python skill scripts.

Importing this module is harmless in an ordinary script run. The OpenTelemetry
packages are loaded only when AGENTOPS_RUN_ID is present.
"""

from contextlib import contextmanager
import os
import platform
import logging
import re
import sys
from urllib.parse import urlsplit


_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_TRACEPARENT = re.compile(r"^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$")


def _record_error(span, error):
    span.set_attribute("error.type", type(error).__name__)
    try:
        from opentelemetry.trace import Status, StatusCode
        span.set_status(Status(StatusCode.ERROR))
    except ImportError:
        span.set_status(2)


class ScriptObservation:
    def __init__(self, tracer=None, script_name=""):
        self._tracer = tracer
        self._script_name = script_name

    @contextmanager
    def step(self, name):
        """Record a meaningful internal step without changing script behavior."""
        if self._tracer is None:
            yield
            return
        with self._tracer.start_as_current_span(
            "agentops.script.step", attributes={
                "agentops.step.name": str(name)[:128], "agentops.script.name": self._script_name,
                "agentops.script.runtime.name": "python",
                "agentops.script.runtime.version": platform.python_version(),
                "agentops.script.runtime.implementation": platform.python_implementation(),
            },
            record_exception=False, set_status_on_exception=False,
        ) as span:
            try:
                yield
            except BaseException as error:
                _record_error(span, error)
                raise


@contextmanager
def observe_script(name):
    """Create script and step spans only for an explicitly observed run.

    AGENTOPS_SCRIPT_OTLP_ENDPOINT must be HTTPS or a loopback HTTP endpoint.
    TRACEPARENT is honored only when a valid W3C context is actually supplied;
    a shared run ID alone never invents a physical parent span.
    """
    run_id = os.environ.get("AGENTOPS_RUN_ID", "")
    if not run_id:
        yield ScriptObservation()
        return
    if not _SAFE_ID.fullmatch(run_id):
        print("AgentOps script telemetry disabled: invalid run ID", file=sys.stderr)
        yield ScriptObservation()
        return

    endpoint = os.environ.get("AGENTOPS_SCRIPT_OTLP_ENDPOINT", "")
    try:
        parsed = urlsplit(endpoint)
        valid_endpoint = bool(parsed.hostname) and (
            parsed.scheme == "https" or
            parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "::1"} and parsed.port is not None
        ) and not any((parsed.username, parsed.password, parsed.query, parsed.fragment))
    except ValueError:
        valid_endpoint = False
    if not valid_endpoint:
        print("AgentOps script telemetry disabled: endpoint must be HTTPS or loopback HTTP", file=sys.stderr)
        yield ScriptObservation()
        return

    provider = None
    exporter_logger = None
    exporter_logger_disabled = None
    fallback_parent = None
    try:
        from opentelemetry import context as otel_context
        from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        resource = Resource.create({
            "service.name": "agentops-skill-script",
            "agentops.run.id": run_id,
            "agentops.session.id": os.environ.get("AGENTOPS_SESSION_ID", ""),
            "agentops.script.runtime.name": "python",
            "agentops.script.runtime.version": platform.python_version(),
            "agentops.script.runtime.implementation": platform.python_implementation(),
        })
        provider = TracerProvider(resource=resource)
        # The SDK exporter logs retries to stderr and may retry an unreachable
        # collector for much longer than the script itself. Observation is
        # fail-open: bound that wait and silence only its exporter diagnostics.
        exporter = OTLPSpanExporter(endpoint=endpoint, timeout=1)
        exporter_logger = getattr(getattr(exporter, "_client", None), "_logger", None)
        if isinstance(exporter_logger, logging.Logger):
            exporter_logger_disabled = exporter_logger.disabled
            exporter_logger.disabled = True
        provider.add_span_processor(BatchSpanProcessor(exporter, export_timeout_millis=1000))
        tracer = provider.get_tracer("agentops.skill-script")
        traceparent = os.environ.get("TRACEPARENT", "").lower()
        parent = (TraceContextTextMapPropagator().extract({"traceparent": traceparent})
                  if _TRACEPARENT.fullmatch(traceparent) else otel_context.Context())
    except ImportError:
        try:
            from otlp_stdlib import create_tracer
            tracer, fallback_parent = create_tracer(
                endpoint,
                run_id,
                os.environ.get("AGENTOPS_SESSION_ID", ""),
                os.environ.get("TRACEPARENT", "").lower(),
            )
            parent = None
        except Exception as error:
            print(f"AgentOps script telemetry disabled: {type(error).__name__}", file=sys.stderr)
            yield ScriptObservation()
            return
    except Exception as error:
        print(f"AgentOps script telemetry disabled: {type(error).__name__}", file=sys.stderr)
        yield ScriptObservation()
        return
    try:
        root_options = {
            "attributes": {
                "agentops.script.name": str(name)[:128],
                "gen_ai.operation.name": "script.execute",
                "agentops.script.runtime.name": "python",
                "agentops.script.runtime.version": platform.python_version(),
                "agentops.script.runtime.implementation": platform.python_implementation(),
            },
            "record_exception": False,
            "set_status_on_exception": False,
        }
        if fallback_parent:
            root_options["parent"] = fallback_parent
        else:
            root_options["context"] = parent
        with tracer.start_as_current_span("agentops.script", **root_options) as span:
            try:
                yield ScriptObservation(tracer, str(name)[:128])
            except BaseException as error:
                _record_error(span, error)
                raise
    finally:
        if provider is not None:
            try:
                provider.force_flush(timeout_millis=1500)
                provider.shutdown()
            except Exception:
                pass
            finally:
                if exporter_logger is not None and exporter_logger_disabled is not None:
                    exporter_logger.disabled = exporter_logger_disabled
