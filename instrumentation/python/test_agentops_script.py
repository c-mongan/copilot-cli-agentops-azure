import contextlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import os
import threading
import unittest
from unittest.mock import patch

from agentops_script import observe_script


class CaptureHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.server.payloads.append(self.rfile.read(int(self.headers["Content-Length"])))
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *_args):
        pass


class ScriptObservationTests(unittest.TestCase):
    def test_normal_run_needs_no_sdk_or_telemetry(self):
        with patch.dict(os.environ, {}, clear=True):
            with observe_script("fixture.py") as observation:
                with observation.step("parse"):
                    value = 42
        self.assertEqual(value, 42)

    def test_script_and_internal_step_export_as_real_otel_spans(self):
        from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

        server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
        server.payloads = []
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            endpoint = f"http://127.0.0.1:{server.server_port}/v1/traces"
            with patch.dict(os.environ, {
                "AGENTOPS_RUN_ID": "synthetic-run-1",
                "AGENTOPS_SCRIPT_OTLP_ENDPOINT": endpoint,
                "TRACEPARENT": "",
            }, clear=True):
                with observe_script("fixture.py") as observation:
                    with observation.step("parse"):
                        pass
            self.assertTrue(server.payloads)
            requests = [ExportTraceServiceRequest.FromString(body) for body in server.payloads]
            resources = [resource for request in requests for resource in request.resource_spans]
            spans = [span for resource in resources for scope in resource.scope_spans for span in scope.spans]
            self.assertEqual({span.name for span in spans}, {"agentops.script", "agentops.script.step"})
            root = next(span for span in spans if span.name == "agentops.script")
            step = next(span for span in spans if span.name == "agentops.script.step")
            self.assertEqual(step.trace_id, root.trace_id)
            self.assertEqual(step.parent_span_id, root.span_id)
            self.assertEqual(root.parent_span_id, b"")
            attributes = {entry.key: entry.value.string_value for entry in resources[0].resource.attributes}
            self.assertEqual(attributes["agentops.run.id"], "synthetic-run-1")
            step_attributes = {entry.key: entry.value.string_value for entry in step.attributes}
            self.assertEqual(step_attributes["agentops.step.name"], "parse")
            self.assertEqual(step_attributes["agentops.script.name"], "fixture.py")
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_bad_telemetry_settings_do_not_change_script_result(self):
        errors = io.StringIO()
        with patch.dict(os.environ, {"AGENTOPS_RUN_ID": "synthetic-run-1"}, clear=True), contextlib.redirect_stderr(errors):
            with observe_script("fixture.py") as observation:
                with observation.step("parse"):
                    value = "done"
        self.assertEqual(value, "done")
        self.assertIn("telemetry disabled", errors.getvalue())
        with patch.dict(os.environ, {
            "AGENTOPS_RUN_ID": "synthetic-run-1",
            "AGENTOPS_SCRIPT_OTLP_ENDPOINT": "https://user:password@example.com/v1/traces",
        }, clear=True), contextlib.redirect_stderr(errors):
            with observe_script("fixture.py") as observation:
                with observation.step("parse"):
                    value = "still done"
        self.assertEqual(value, "still done")

    def test_valid_traceparent_is_used_only_when_supplied(self):
        from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

        server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
        server.payloads = []
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with patch.dict(os.environ, {
                "AGENTOPS_RUN_ID": "synthetic-run-parent",
                "AGENTOPS_SCRIPT_OTLP_ENDPOINT": f"http://127.0.0.1:{server.server_port}/v1/traces",
                "TRACEPARENT": "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
            }, clear=True):
                with observe_script("fixture.py"):
                    pass
            spans = [span for body in server.payloads
                     for resource in ExportTraceServiceRequest.FromString(body).resource_spans
                     for scope in resource.scope_spans for span in scope.spans]
            self.assertEqual(len(spans), 1)
            self.assertEqual(spans[0].trace_id.hex(), "0123456789abcdef0123456789abcdef")
            self.assertEqual(spans[0].parent_span_id.hex(), "0123456789abcdef")
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
