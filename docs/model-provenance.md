# Model provenance

A launcher request and a producer request describe different evidence. For example,
`--model mini` in observed launch arguments can coexist with native
`gen_ai.request.model=cloud5.5` and `gen_ai.response.model=cloud5.5`. This is a
reported discrepancy, not proof that the launcher override took effect.

| Evidence | Meaning |
| --- | --- |
| Sanitized launch configuration `observedSettings.model.requested` | Model explicitly requested at launch |
| Explicit `requestedModel` in persisted launch context | Launcher identity when the observed configuration is unavailable |
| Event/span `ModelRequested` | Producer-declared requested model |
| Native span `ModelActual` | Observed response identity; the legacy `Model` fallback cannot prove this |
| Session model declarations | Reported configuration, not proof of usage |

`reconcileModelProvenance({launchExecutionConfiguration, requestedModel, events,
nativeSpans})` returns the launcher request and its source separately from sorted,
deduplicated producer requests, actual response models, model/provider response
pairs, and session declarations. Unknown providers stay null in response pairs.
Script spans are excluded. Native response identities are aggregated across the
available spans, including different models used by subagents. Missing response
identity stays unknown. Multiple response models are marked mixed; models differing
from the launcher request are marked conflicting. A producer request/response
discrepancy is reported independently even when launcher intent is unknown. Matching observations never
certify an override. This reconciliation describes available evidence, not all
possible model calls in a session.

Replay callers pass `launchExecutionConfiguration` or the explicit launcher
`requestedModel` as rendering options. Producer fields must never be passed as this
launcher fallback. Persist only the sanitized observed configuration; raw command
arguments, prompts, secrets, and ambient configuration are not provenance metadata.
An unknown launcher request remains unknown for historical runs without launch
context. A supplied configuration hash alone does not reveal launcher identity.

Model/provider identifiers are bounded and reject URLs, userinfo, known credential
prefixes, and secret assignments. Replay applies the same sanitizer before building
row labels, metrics and details, so rejected identities cannot leak through the
legacy timeline or the provenance section. Rejected identities remain unknown.

Existing event/span exports retain their schemas and their producer model fields.
Run-summary `ModelRequested` remains legacy launcher metadata and must not be used
as actual model identity. Actual usage requires native response evidence.

Replay has one top-level `main` landmark containing the summary and all evidence
sections. `timeline` remains the same anchor on a `div`; event anchors, filters,
search and jump links retain their existing behavior.
