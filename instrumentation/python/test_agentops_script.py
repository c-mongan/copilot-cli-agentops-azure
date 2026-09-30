import contextlib
import builtins
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
import platform
from pathlib import Path
import subprocess
import sys
import tempfile
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
            self.assertEqual(step_attributes["agentops.script.runtime.name"], "python")
            self.assertEqual(step_attributes["agentops.script.runtime.version"], platform.python_version())
            self.assertEqual(step_attributes["agentops.script.runtime.implementation"], platform.python_implementation())
            root_attributes = {entry.key: entry.value.string_value for entry in root.attributes}
            self.assertEqual(root_attributes["agentops.script.runtime.name"], "python")
            self.assertEqual(root_attributes["agentops.script.runtime.version"], platform.python_version())
            self.assertEqual(root_attributes["agentops.script.runtime.implementation"], platform.python_implementation())
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_stdlib_fallback_exports_root_and_child_without_sdk(self):
        from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

        server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
        server.payloads = []
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        original_import = builtins.__import__

        def without_otel(name, *args, **kwargs):
            if name == "opentelemetry" or name.startswith("opentelemetry."):
                raise ImportError("synthetic missing SDK")
            return original_import(name, *args, **kwargs)

        try:
            with patch.dict(os.environ, {
                "AGENTOPS_RUN_ID": "stdlib-fallback-run",
                "AGENTOPS_SCRIPT_OTLP_ENDPOINT": f"http://127.0.0.1:{server.server_port}/v1/traces",
                "AGENTOPS_SESSION_ID": "synthetic-session",
            }, clear=True), patch("builtins.__import__", side_effect=without_otel):
                with observe_script("tools/probe.py") as observation:
                    with observation.step("work"):
                        pass

            spans = [span for body in server.payloads
                     for resource in ExportTraceServiceRequest.FromString(body).resource_spans
                     for scope in resource.scope_spans for span in scope.spans]
            self.assertEqual({span.name for span in spans}, {"agentops.script", "agentops.script.step"})
            root = next(span for span in spans if span.name == "agentops.script")
            step = next(span for span in spans if span.name == "agentops.script.step")
            self.assertEqual(step.trace_id, root.trace_id)
            self.assertEqual(step.parent_span_id, root.span_id)
            request = ExportTraceServiceRequest.FromString(server.payloads[0])
            resources = {entry.key: entry.value.string_value for entry in request.resource_spans[0].resource.attributes}
            self.assertEqual(resources["agentops.run.id"], "stdlib-fallback-run")
            self.assertEqual(resources["agentops.session.id"], "synthetic-session")
            self.assertEqual(resources["agentops.script.runtime.name"], "python")
            self.assertEqual(resources["agentops.script.runtime.version"], platform.python_version())
            self.assertEqual(resources["agentops.script.runtime.implementation"], platform.python_implementation())
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_stdlib_fallback_preserves_script_failure_without_exporting_message(self):
        from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

        server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
        server.payloads = []
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        original_import = builtins.__import__

        def without_otel(name, *args, **kwargs):
            if name == "opentelemetry" or name.startswith("opentelemetry."):
                raise ImportError("synthetic missing SDK")
            return original_import(name, *args, **kwargs)

        try:
            with patch.dict(os.environ, {
                "AGENTOPS_RUN_ID": "stdlib-failure-run",
                "AGENTOPS_SCRIPT_OTLP_ENDPOINT": f"http://127.0.0.1:{server.server_port}/v1/traces",
            }, clear=True), patch("builtins.__import__", side_effect=without_otel):
                with self.assertRaisesRegex(ValueError, "private synthetic message"):
                    with observe_script("tools/fail.py") as observation:
                        with observation.step("validate"):
                            raise ValueError("private synthetic message")

            spans = [span for body in server.payloads
                     for resource in ExportTraceServiceRequest.FromString(body).resource_spans
                     for scope in resource.scope_spans for span in scope.spans]
            self.assertEqual(len(spans), 2)
            self.assertTrue(all(span.status.code == 2 for span in spans))
            self.assertTrue(all(
                attribute.key != "error.message"
                for span in spans for attribute in span.attributes
            ))
            self.assertTrue(all("private synthetic message" not in str(span) for span in spans))
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

    def test_sitecustomize_auto_traces_only_an_unchanged_inventoried_repo_script(self):
        from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

        server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
        server.payloads = []
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory(prefix="agentops-python-auto-") as directory:
                repo = Path(directory)
                script = repo / "src" / "run.py"
                script.parent.mkdir(parents=True)
                script.write_text('print("synthetic-script-ok")\n', encoding="utf-8")
                relative = script.relative_to(repo).as_posix()
                manifest = repo / ".agentops" / "attachment.json"
                manifest.parent.mkdir()
                manifest.write_text(json.dumps({
                    "managedBy": "copilot-agentops",
                    "schemaVersion": 1,
                    "architecture": {"runtimeScripts": [{
                        "path": relative,
                        "sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
                    }]},
                }), encoding="utf-8")
                env = {
                    "PYTHONPATH": str(Path(__file__).parent),
                    "AGENTOPS_RUN_ID": "synthetic-auto-run",
                    "AGENTOPS_REPO_ROOT": str(repo),
                    "AGENTOPS_ATTACHMENT_MANIFEST": str(manifest),
                    "AGENTOPS_SCRIPT_OTLP_ENDPOINT": f"http://127.0.0.1:{server.server_port}/v1/traces",
                }
                result = subprocess.run([sys.executable, str(script)], text=True, capture_output=True, env=env, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), "synthetic-script-ok")
                spans = [span for body in server.payloads
                         for resource in ExportTraceServiceRequest.FromString(body).resource_spans
                         for scope in resource.scope_spans for span in scope.spans]
                self.assertEqual(len(spans), 1)
                self.assertEqual(spans[0].name, "agentops.script")
                attributes = {entry.key: entry.value.string_value for entry in spans[0].attributes}
                self.assertEqual(attributes["agentops.script.name"], relative)
                request = ExportTraceServiceRequest.FromString(server.payloads[0])
                resource_attributes = {entry.key: entry.value.string_value for entry in request.resource_spans[0].resource.attributes}
                self.assertEqual(resource_attributes["agentops.run.id"], "synthetic-auto-run")

                server.payloads.clear()
                script.write_text('print("changed-script-ok")\n', encoding="utf-8")
                changed = subprocess.run([sys.executable, str(script)], text=True, capture_output=True, env=env, check=False)
                self.assertEqual(changed.returncode, 0, changed.stderr)
                self.assertEqual(changed.stdout.strip(), "changed-script-ok")
                self.assertEqual(server.payloads, [])
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_sitecustomize_records_script_failure_without_changing_exit_status(self):
        from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

        server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
        server.payloads = []
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory(prefix="agentops-python-auto-error-") as directory:
                repo = Path(directory)
                script = repo / ".agents" / "skills" / "fixture" / "scripts" / "fail.py"
                script.parent.mkdir(parents=True)
                script.write_text('raise ValueError("synthetic private fixture")\n', encoding="utf-8")
                relative = script.relative_to(repo).as_posix()
                manifest = repo / ".agentops" / "attachment.json"
                manifest.parent.mkdir()
                manifest.write_text(json.dumps({
                    "managedBy": "copilot-agentops",
                    "schemaVersion": 1,
                    "architecture": {"skills": [{"scripts": [{
                        "path": relative,
                        "sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
                    }]}]},
                }), encoding="utf-8")
                env = {
                    "PYTHONPATH": str(Path(__file__).parent),
                    "AGENTOPS_RUN_ID": "synthetic-error-run",
                    "AGENTOPS_REPO_ROOT": str(repo),
                    "AGENTOPS_ATTACHMENT_MANIFEST": str(manifest),
                    "AGENTOPS_SCRIPT_OTLP_ENDPOINT": f"http://127.0.0.1:{server.server_port}/v1/traces",
                }
                result = subprocess.run([sys.executable, str(script)], text=True, capture_output=True, env=env, check=False)
                self.assertEqual(result.returncode, 1)
                spans = [span for body in server.payloads
                         for resource in ExportTraceServiceRequest.FromString(body).resource_spans
                         for scope in resource.scope_spans for span in scope.spans]
                self.assertEqual(len(spans), 1)
                self.assertEqual(spans[0].status.code, 2)
                attributes = {entry.key: entry.value.string_value for entry in spans[0].attributes}
                self.assertEqual(attributes["error.type"], "ValueError")
                self.assertNotIn("synthetic private fixture", str(spans[0]))
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_attached_script_output_and_exit_status_match_with_telemetry_off_on_and_unavailable(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), CaptureHandler)
        server.payloads = []
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory(prefix="agentops-python-parity-") as directory:
                repo = Path(directory)
                script = repo / ".agents" / "skills" / "fixture" / "scripts" / "parity.py"
                script.parent.mkdir(parents=True)
                script.write_text('print("agent task output")\nraise ValueError("synthetic parity failure")\n', encoding="utf-8")
                relative = script.relative_to(repo).as_posix()
                manifest = repo / ".agentops" / "attachment.json"
                manifest.parent.mkdir()
                manifest.write_text(json.dumps({
                    "managedBy": "copilot-agentops",
                    "schemaVersion": 1,
                    "architecture": {"runtimeScripts": [{
                        "path": relative,
                        "sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
                    }]},
                }), encoding="utf-8")
                baseline_env = os.environ.copy()
                for key in (
                    "AGENTOPS_RUN_ID", "AGENTOPS_SESSION_ID", "AGENTOPS_REPO_ROOT",
                    "AGENTOPS_ATTACHMENT_MANIFEST", "AGENTOPS_SCRIPT_OTLP_ENDPOINT",
                ):
                    baseline_env.pop(key, None)
                baseline_env["PYTHONPATH"] = str(Path(__file__).parent)
                observed_env = baseline_env | {
                    "AGENTOPS_RUN_ID": "synthetic-python-parity-run",
                    "AGENTOPS_REPO_ROOT": str(repo),
                    "AGENTOPS_ATTACHMENT_MANIFEST": str(manifest),
                    "AGENTOPS_SCRIPT_OTLP_ENDPOINT": f"http://127.0.0.1:{server.server_port}/v1/traces",
                }
                unavailable_env = observed_env | {
                    "AGENTOPS_SCRIPT_OTLP_ENDPOINT": "http://127.0.0.1:1/v1/traces",
                }

                def execute(env):
                    return subprocess.run(
                        [sys.executable, str(script)], text=True, capture_output=True, env=env, check=False,
                    )

                baseline = execute(baseline_env)
                observed = execute(observed_env)
                unavailable = execute(unavailable_env)
                for result in (observed, unavailable):
                    self.assertEqual(result.returncode, baseline.returncode)
                    self.assertEqual(result.stdout, baseline.stdout)
                    self.assertEqual(result.stderr, baseline.stderr)
                self.assertEqual(baseline.returncode, 1)
                self.assertEqual(baseline.stdout.strip(), "agent task output")
                self.assertEqual(len(server.payloads), 1)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
