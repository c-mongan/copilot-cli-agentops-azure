"""End-to-end assertions over real Pydantic AI + OTel exported spans."""
import json
from pathlib import Path
import subprocess
import sys
import pytest

HERE = Path(__file__).parent

@pytest.fixture(scope='module')
def run(tmp_path_factory):
    path = tmp_path_factory.mktemp('demo') / 'spans.json'
    proc = subprocess.run([sys.executable, str(HERE / 'demo.py'), '--output', str(path)],
                          capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout), json.loads(path.read_text())

@pytest.mark.parametrize('case,outcome', [
    ('supported','supported'), ('missing-evidence','needs_evidence'),
    ('tool-failure','tool_error'), ('model-failure','model_error')])
def test_scenarios(run, case, outcome):
    summary, spans = run
    result = next(r for r in summary['results'] if r['scenario'] == case)
    assert result['outcome'] == outcome
    trace = [s for s in spans if s['trace_id'] == result['trace_id']]
    roots = [s for s in trace if s['parent_span_id'] is None]
    assert len(roots) == 1
    assert roots[0]['attributes']['demo.outcome'] == outcome
    ids = {s['span_id'] for s in trace}
    assert all(s['parent_span_id'] in ids for s in trace if s['parent_span_id'])
    assert all(s['duration_ms'] >= 0 for s in trace)
    assert any(s['name'] == 'agentops.script.step' for s in trace)
    assert any(s['name'].startswith('chat ') for s in trace)
    if case == 'tool-failure':
        assert any(s['attributes'].get('demo.failure.domain') == 'tool' and s['status'] == 'ERROR' for s in trace)
        assert any(s['name'] == 'demo.fetch_evidence' and s['duration_ms'] >= 15 for s in trace)
    if case == 'model-failure':
        assert any(s['attributes'].get('demo.failure.domain') == 'model' and s['status'] == 'ERROR' for s in trace)
    if case == 'missing-evidence':
        assert roots[0]['attributes']['demo.evidence.missing_count'] == 1


def test_no_content_or_exception_payloads_leave_export_boundary(run):
    summary, spans = run
    wire = json.dumps(spans)
    for forbidden in ['PRIVATE_SENTINEL', 'exception.message', 'exception.stacktrace',
                      'gen_ai.input.messages', 'gen_ai.output.messages', 'tool.arguments',
                      'synthetic prompt body', 'dependency resolver raw output']:
        assert forbidden not in wire
    assert all(not s['events'] for s in spans)
    assert summary['ingestion'] == 'not_attempted'
    assert summary['model_mode'] == 'deterministic_function_model'


def test_remote_export_requires_explicit_token(tmp_path):
    import os
    env = os.environ.copy()
    env.pop('LOGFIRE_TOKEN', None)
    proc = subprocess.run([sys.executable, str(HERE / 'demo.py'), '--send', '--output', str(tmp_path/'spans.json')],
                          env=env, capture_output=True, text=True)
    assert proc.returncode != 0
    assert 'LOGFIRE_TOKEN is required' in proc.stderr


def test_remote_receives_only_sanitized_spans():
    from demo import PublicExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import ReadableSpan, Event
    from opentelemetry.trace import Status, StatusCode, SpanContext, TraceFlags
    from opentelemetry.sdk.trace.export import SpanExportResult

    class Transport:
        def export(self, spans):
            self.received = spans
            return SpanExportResult.SUCCESS

    transport = Transport()
    exporter = PublicExporter(transport)
    raw = ReadableSpan('demo.diagnosis', context=SpanContext(1, 2, False, TraceFlags(1)),
                       attributes={'demo.outcome': 'tool_error', 'secret': 'PRIVATE_SENTINEL'},
                       resource=Resource({'host.name': 'PRIVATE_SENTINEL'}),
                       status=Status(StatusCode.ERROR, 'PRIVATE_SENTINEL'),
                       events=[Event('exception', {'exception.message': 'PRIVATE_SENTINEL'})],
                       start_time=1, end_time=2)
    assert exporter.export([raw]) == SpanExportResult.SUCCESS
    sent = transport.received[0]
    assert dict(sent.attributes) == {'demo.outcome': 'tool_error'}
    assert dict(sent.resource.attributes) == {'service.name': 'agentops-logfire-cicd-demo', 'demo.data': 'synthetic'}
    assert not sent.events
    assert sent.status.description is None


def test_failed_transport_is_not_acknowledged():
    from demo import PublicExporter
    from opentelemetry.sdk.trace.export import SpanExportResult

    class Transport:
        def export(self, spans):
            return SpanExportResult.FAILURE

    exporter = PublicExporter(Transport())
    assert exporter.export([]) == SpanExportResult.FAILURE
    assert exporter.attempts == 1
    assert exporter.failures == 1


def test_ambient_sampling_and_export_configuration_do_not_change_local_mode(tmp_path):
    import os
    env = dict(os.environ, OTEL_TRACES_SAMPLER='always_off',
               OTEL_EXPORTER_OTLP_ENDPOINT='http://127.0.0.1:1',
               LOGFIRE_SEND_TO_LOGFIRE='true', LOGFIRE_TOKEN='PRIVATE_SENTINEL')
    path = tmp_path / 'spans.json'
    proc = subprocess.run([sys.executable, str(HERE/'demo.py'), '--output', str(path)],
                          env=env, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    summary = json.loads(proc.stdout)
    assert summary['span_count'] == 27
    assert summary['export_attempts'] == 0
    assert summary['ingestion'] == 'not_attempted'
    assert 'PRIVATE_SENTINEL' not in proc.stdout + proc.stderr + path.read_text()
