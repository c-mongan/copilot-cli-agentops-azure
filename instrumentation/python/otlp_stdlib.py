"""Minimal fail-open OTLP/HTTP protobuf exporter using only the Python stdlib."""

from contextlib import contextmanager
from contextvars import ContextVar
import secrets
import struct
import time
import platform
from urllib.request import Request, urlopen


_CURRENT_SPAN = ContextVar("agentops_current_span", default=None)
_OTEL_SCOPE = "agentops.skill-script"


def _varint(value):
    value = int(value)
    encoded = bytearray()
    while value > 0x7F:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    encoded.append(value)
    return bytes(encoded)


def _bytes_field(number, value):
    value = bytes(value)
    return _varint((number << 3) | 2) + _varint(len(value)) + value


def _string_field(number, value):
    return _bytes_field(number, str(value).encode("utf-8"))


def _fixed64_field(number, value):
    return _varint((number << 3) | 1) + struct.pack("<Q", int(value))


def _any_string(value):
    return _string_field(1, value)


def _key_value(key, value):
    return _string_field(1, key) + _bytes_field(2, _any_string(value))


def _span_attribute(key, value):
    if isinstance(value, bool):
        any_value = _varint(2 << 3) + _varint(1 if value else 0)
    elif isinstance(value, int):
        any_value = _varint(3 << 3) + _varint(value)
    else:
        any_value = _any_string(value)
    return _string_field(1, key) + _bytes_field(2, any_value)


def _resource_spans(resource, spans):
    resource_message = b"".join(_bytes_field(1, _key_value(key, value)) for key, value in resource.items())
    scope = _string_field(1, _OTEL_SCOPE)
    scope_spans = _bytes_field(1, scope) + b"".join(_bytes_field(2, span.encode()) for span in spans)
    return _bytes_field(1, resource_message) + _bytes_field(2, scope_spans)


class StdlibSpan:
    def __init__(self, tracer, name, attributes=None, parent=None):
        self._tracer = tracer
        self.name = str(name)[:128]
        self.attributes = dict(attributes or {})
        self.trace_id = parent.trace_id if parent else secrets.token_bytes(16)
        self.span_id = secrets.token_bytes(8)
        self.parent_span_id = parent.span_id if parent else b""
        self.start_ns = time.time_ns()
        self.end_ns = self.start_ns
        self.status = 0

    def set_attribute(self, key, value):
        self.attributes[str(key)[:128]] = value

    def set_status(self, status):
        code = getattr(status, "status_code", None)
        self.status = 2 if getattr(code, "name", "") == "ERROR" or status == 2 else 0

    def encode(self):
        payload = (
            _bytes_field(1, self.trace_id)
            + _bytes_field(2, self.span_id)
            + (_bytes_field(4, self.parent_span_id) if self.parent_span_id else b"")
            + _string_field(5, self.name)
            + _varint(6 << 3) + _varint(1)
            + _fixed64_field(7, self.start_ns)
            + _fixed64_field(8, self.end_ns)
            + b"".join(_bytes_field(9, _span_attribute(key, value)) for key, value in self.attributes.items())
        )
        if self.status:
            status = _varint(3 << 3) + _varint(self.status)
            payload += _bytes_field(15, status)
        return payload


class StdlibTracer:
    def __init__(self, endpoint, resource):
        self.endpoint = endpoint
        self.resource = resource

    @contextmanager
    def start_as_current_span(self, name, attributes=None, parent=None, **_kwargs):
        parent = parent or _CURRENT_SPAN.get()
        span = StdlibSpan(self, name, attributes, parent)
        token = _CURRENT_SPAN.set(span)
        try:
            yield span
        except BaseException as error:
            span.set_attribute("error.type", type(error).__name__)
            span.status = 2
            raise
        finally:
            span.end_ns = time.time_ns()
            _CURRENT_SPAN.reset(token)
            try:
                request = Request(
                    self.endpoint,
                    data=_bytes_field(1, _resource_spans(self.resource, [span])),
                    headers={"Content-Type": "application/x-protobuf"},
                    method="POST",
                )
                with urlopen(request, timeout=3) as response:
                    response.read(1024)
            except Exception:
                # Telemetry must never change the script's outcome.
                pass


def create_tracer(endpoint, run_id, session_id="", traceparent=""):
    resource = {
        "service.name": "agentops-skill-script",
        "agentops.run.id": run_id,
        "agentops.script.runtime.name": "python",
        "agentops.script.runtime.version": platform.python_version(),
        "agentops.script.runtime.implementation": platform.python_implementation(),
    }
    if session_id:
        resource["agentops.session.id"] = session_id
    parent = None
    parts = traceparent.split("-")
    if (len(parts) == 4 and parts[0] == "00" and len(parts[1]) == 32
            and len(parts[2]) == 16 and all(c in "0123456789abcdef" for c in parts[1] + parts[2])
            and parts[1] != "0" * 32 and parts[2] != "0" * 16):
        parent = type("TraceParent", (), {
            "trace_id": bytes.fromhex(parts[1]),
            "span_id": bytes.fromhex(parts[2]),
        })()
    tracer = StdlibTracer(endpoint, resource)
    return tracer, parent
