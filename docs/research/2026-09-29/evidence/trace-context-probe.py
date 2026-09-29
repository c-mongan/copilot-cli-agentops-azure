"""Disposable OTel process-boundary probe, not Copilot instrumentation."""
from __future__ import annotations
import json, os, subprocess, sys
from importlib.metadata import version
from opentelemetry import propagate, trace
from opentelemetry.sdk.trace import TracerProvider

trace.set_tracer_provider(TracerProvider())
tracer = trace.get_tracer('research.process-context')
if len(sys.argv) > 1:
    mode = sys.argv[1]
    context = propagate.extract({'traceparent': os.environ.get('TRACEPARENT', '')}) if mode in ('extract', 'invalid') else None
    with tracer.start_as_current_span('child', context=context) as span:
        sc = span.get_span_context()
        print(json.dumps({'trace_id': f'{sc.trace_id:032x}', 'span_id': f'{sc.span_id:016x}',
            'parent_span_id': f'{span.parent.span_id:016x}' if span.parent else None,
            'carrier_present': bool(os.environ.get('TRACEPARENT'))}))
else:
    out = {'scope': 'Generic Python OTel only; Copilot CLI, SDK, VS Code and Azure not executed',
           'python': sys.version.split()[0], 'opentelemetry_sdk': version('opentelemetry-sdk'), 'cases': {}}
    with tracer.start_as_current_span('synthetic_tool') as parent:
        p = parent.get_span_context()
        out['parent'] = {'trace_id': f'{p.trace_id:032x}', 'span_id': f'{p.span_id:016x}'}
        carrier: dict[str, str] = {}
        propagate.inject(carrier)
        for mode in ('absent', 'no_extract', 'extract', 'invalid'):
            env = {k:v for k,v in os.environ.items() if k not in ('TRACEPARENT','TRACESTATE')}
            if mode != 'absent':
                env['TRACEPARENT'] = 'not-a-valid-context' if mode == 'invalid' else carrier['traceparent']
            raw = subprocess.check_output([sys.executable, __file__, mode], env=env, text=True, timeout=10)
            result = json.loads(raw)
            result['same_trace'] = result['trace_id'] == out['parent']['trace_id']
            result['correct_parent'] = result['parent_span_id'] == out['parent']['span_id']
            out['cases'][mode] = result
    assert not out['cases']['absent']['same_trace']
    assert not out['cases']['no_extract']['same_trace']
    assert out['cases']['extract']['same_trace'] and out['cases']['extract']['correct_parent']
    assert not out['cases']['invalid']['same_trace']
    out['assertions_passed'] = 4
    print(json.dumps(out, indent=2))
