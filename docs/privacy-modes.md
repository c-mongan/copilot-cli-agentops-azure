# Privacy Modes

## Strict

`AGENTOPS_PRIVACY_MODE=strict` is the default.

Strict mode allowlists safe metadata and drops/redacts everything else before export. It also adds `agentops.content_capture.signal=true` when content-like fields are observed, without storing the content.

## Compat

`AGENTOPS_PRIVACY_MODE=compat` uses the older denylist scrubber. It is useful for compatibility testing but is less defensive against unknown future content fields.

## Validate

```bash
agentops collector validate --mode auto --privacy strict --json
agentops collector smoke --privacy strict --poison --json
```

The poison smoke test injects synthetic `SECRET_*` fields and checks that strict sanitizing does not emit them.
