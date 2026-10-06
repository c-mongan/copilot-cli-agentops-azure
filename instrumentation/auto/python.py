"""Explicit project bootstrap. It does not install or replace sitecustomize."""
import importlib.metadata
import os
from pathlib import Path
import runpy
import sys


def main():
    root = Path(os.environ['AGENTOPS_AUTO_PROJECT_ROOT']).resolve(strict=True)
    target = Path(sys.argv[1]).resolve(strict=True)
    if not target.is_file() or not target.is_relative_to(root):
        raise RuntimeError('AgentOps entry outside approved project')
    from opentelemetry import context, propagate, trace
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    provider = TracerProvider(resource=Resource.create({
        'service.name': 'agentops.project',
        'agentops.run.id': os.environ.get('OTEL_RESOURCE_ATTRIBUTES', '').removeprefix('agentops.run.id=')
    }))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
        endpoint=os.environ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'], headers={})))
    trace.set_tracer_provider(provider)
    disabled = set(os.environ.get('OTEL_PYTHON_DISABLED_INSTRUMENTATIONS', '').split(','))
    instrumented = []
    for entry in importlib.metadata.entry_points(group='opentelemetry_instrumentor'):
        if entry.name in disabled:
            continue
        instrumentor = entry.load()()
        instrumentor.instrument()
        instrumented.append(instrumentor)
    token = context.attach(propagate.extract({'traceparent': os.environ.get('AGENTOPS_AUTO_TRACEPARENT', '')}))
    try:
        sys.argv = [str(target), *sys.argv[2:]]
        sys.path.insert(0, str(target.parent))
        runpy.run_path(str(target), run_name='__main__')
    finally:
        context.detach(token)
        provider.shutdown()


if __name__ == '__main__':
    main()
