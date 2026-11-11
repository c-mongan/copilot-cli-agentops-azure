"""Synthetic CI diagnosis traces. No real model, CI service, or private inputs."""
import argparse
import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
from typing import Literal
from uuid import uuid4

import logfire
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult
from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.instrumented import InstrumentationSettings

# Reuse the observer, without its independent provider/OTLP lifecycle.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'instrumentation' / 'python'))
from agentops_script import ScriptObservation

SCENARIOS = ('supported', 'missing-evidence', 'tool-failure', 'model-failure')
SERVICE = 'agentops-logfire-cicd-demo'
SAFE_ATTRIBUTES = {
    'demo.run_id', 'demo.scenario', 'demo.outcome', 'demo.failure.domain',
    'demo.evidence.missing_count', 'demo.evidence.missing', 'demo.model.mode',
    'error.type', 'agentops.step.name', 'agentops.script.name',
    'gen_ai.operation.name', 'gen_ai.provider.name', 'gen_ai.request.model',
    'gen_ai.response.model', 'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens',
    'gen_ai.tool.name', 'gen_ai.tool.call.id',
}


def public_span(span):
    """Single export boundary: drop payloads, events, links and host resources."""
    return ReadableSpan(
        name=span.name, context=span.context, parent=span.parent, kind=span.kind,
        start_time=span.start_time, end_time=span.end_time,
        status=Status(span.status.status_code),
        resource=Resource({'service.name': SERVICE, 'demo.data': 'synthetic'}),
        attributes={k: v for k, v in span.attributes.items() if k in SAFE_ATTRIBUTES},
        events=(), links=(), instrumentation_scope=span.instrumentation_scope,
    )


class PublicExporter(SpanExporter):
    def __init__(self, remote=None):
        self.remote = remote
        self.spans = []
        self.attempts = 0
        self.failures = 0

    def export(self, spans):
        safe = [public_span(s) for s in spans]
        self.spans.extend(safe)
        if self.remote is None:
            return SpanExportResult.SUCCESS
        self.attempts += 1
        try:
            result = self.remote.export(safe)
        except Exception:
            result = SpanExportResult.FAILURE
        self.failures += int(result != SpanExportResult.SUCCESS)
        return result

    def shutdown(self):
        if self.remote:
            self.remote.shutdown()

    def write(self, path):
        def span_id(ctx):
            return f'{ctx.span_id:016x}' if ctx else None
        rows = [{
            'name': s.name, 'trace_id': f'{s.context.trace_id:032x}',
            'span_id': span_id(s.context), 'parent_span_id': span_id(s.parent),
            'duration_ms': round((s.end_time - s.start_time) / 1e6, 3),
            'status': s.status.status_code.name, 'attributes': dict(s.attributes),
            'events': [],
        } for s in self.spans]
        path.write_text(json.dumps(rows, indent=2) + '\n')


class Diagnosis(BaseModel):
    verdict: Literal['supported', 'needs_evidence']
    cause: Literal['dependency_conflict', 'unknown']
    evidence_ids: list[Literal['log-001', 'diff-001']]


@contextmanager
def safe_step(tracer, name, domain):
    with tracer.start_as_current_span(name, record_exception=False,
                                     set_status_on_exception=False) as span:
        try:
            yield span
        except Exception as exc:
            span.set_attribute('demo.failure.domain', domain)
            span.set_attribute('error.type', type(exc).__name__)
            span.set_status(Status(StatusCode.ERROR))
            raise


async def diagnose(scenario, tracer, run_id):
    evidence = {'log-001': 'dependency resolver raw output PRIVATE_SENTINEL',
                'diff-001': 'synthetic change: package version raised'}
    if scenario == 'missing-evidence':
        evidence.pop('diff-001')

    async def fetch_evidence() -> dict[str, str]:
        with safe_step(tracer, 'demo.fetch_evidence', 'tool'):
            # Fixed simulated I/O latency; timing is measured, not fabricated.
            await asyncio.sleep(0.02)
            if scenario == 'tool-failure':
                raise TimeoutError('PRIVATE_SENTINEL: synthetic tool response body')
            return evidence

    def scripted_model(messages, info):
        returned = [part for msg in messages for part in msg.parts
                    if isinstance(part, ToolReturnPart) and part.tool_name == 'fetch_evidence']
        if not returned:
            return ModelResponse(parts=[ToolCallPart('fetch_evidence', {})])
        missing = 'diff-001' not in returned[-1].content
        args = {'verdict': 'needs_evidence' if missing else 'supported',
                'cause': 'unknown' if missing else 'dependency_conflict',
                'evidence_ids': list(returned[-1].content)}
        if scenario == 'model-failure':
            # Schema violation triggers actual Pydantic AI output validation failure.
            args['verdict'] = 'PRIVATE_SENTINEL_invalid_output'
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    agent = Agent(FunctionModel(scripted_model, model_name='synthetic-ci-model'),
                  output_type=Diagnosis, tools=[fetch_evidence], retries=0,
                  name='synthetic_ci_diagnoser')
    agent.instrument = InstrumentationSettings(
        include_content=False, include_binary_content=False,
        include_model_request_parameters=False)
    with tracer.start_as_current_span('demo.diagnosis', attributes={
        'demo.run_id': run_id, 'demo.scenario': scenario,
        'demo.model.mode': 'deterministic_function_model',
    }, record_exception=False, set_status_on_exception=False) as root:
        observation = ScriptObservation(tracer, 'synthetic-ci-diagnosis', root)
        missing = ['diff-001'] if scenario == 'missing-evidence' else []
        root.set_attribute('demo.evidence.missing_count', len(missing))
        root.set_attribute('demo.evidence.missing', missing)
        try:
            with observation.step('diagnose'):
                result = await agent.run('synthetic prompt body PRIVATE_SENTINEL')
            output = result.output
            # The decision is checked against available evidence, not accepted blindly.
            if not set(output.evidence_ids).issubset(evidence):
                raise ValueError('unavailable evidence reference')
            if missing and output.verdict == 'supported':
                raise ValueError('unsupported diagnosis')
            outcome = output.verdict
        except TimeoutError:
            outcome = 'tool_error'
            root.set_attribute('demo.failure.domain', 'tool')
            root.set_attribute('error.type', 'TimeoutError')
            root.set_status(Status(StatusCode.ERROR))
        except (UnexpectedModelBehavior, ValueError) as exc:
            outcome = 'model_error'
            root.set_attribute('demo.failure.domain', 'model')
            root.set_attribute('error.type', type(exc).__name__)
            root.set_status(Status(StatusCode.ERROR))
        root.set_attribute('demo.outcome', outcome)
        return {'scenario': scenario, 'outcome': outcome,
                'trace_id': f'{root.get_span_context().trace_id:032x}'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--send', action='store_true', help='Opt in to EU Logfire export')
    parser.add_argument('--output', type=Path, default=Path('spans.json'))
    args = parser.parse_args()
    token = os.environ.get('LOGFIRE_TOKEN')
    if args.send and not token:
        parser.error('LOGFIRE_TOKEN is required for --send; never paste it into source')
    # Prevent ambient OTLP variables from adding exporters that bypass the filter.
    for key in list(os.environ):
        if key.startswith('OTEL_EXPORTER_') or key in {'OTEL_TRACES_SAMPLER', 'OTEL_TRACES_SAMPLER_ARG', 'OTEL_SDK_DISABLED'}:
            del os.environ[key]
    remote = None
    if args.send:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        remote = OTLPSpanExporter(endpoint='https://logfire-eu.pydantic.dev/v1/traces',
                                  headers={'Authorization': f'Bearer {token}'}, timeout=5)
    exporter = PublicExporter(remote)
    logfire.configure(send_to_logfire=False, console=False, metrics=False,
                      service_name=SERVICE, inspect_arguments=False,
                      sampling=logfire.SamplingOptions(head=1.0),
                      additional_span_processors=[SimpleSpanProcessor(exporter)],
                      advanced=logfire.AdvancedOptions(emit_configuration_span=False))
    tracer = trace.get_tracer('agentops.logfire-demo')
    run_id = f'demo-{uuid4().hex[:12]}'

    async def run_all():
        return [await diagnose(s, tracer, run_id) for s in SCENARIOS]

    results = asyncio.run(run_all())
    flushed = logfire.force_flush(timeout_millis=10000)
    exporter.write(args.output)
    ingestion = ('export_failed' if exporter.failures or not flushed else
                 'export_acknowledged_not_readback_verified') if args.send else 'not_attempted'
    print(json.dumps({'run_id': run_id, 'model_mode': 'deterministic_function_model',
                      'ingestion': ingestion, 'export_attempts': exporter.attempts,
                      'export_failures': exporter.failures, 'span_count': len(exporter.spans),
                      'results': results}, indent=2))
    return 1 if args.send and ingestion == 'export_failed' else 0


if __name__ == '__main__':
    raise SystemExit(main())
