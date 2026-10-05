# Treatment-aware experiment comparison

Compare preserves each stored `accepted`, `rejected`, or `inconclusive` decision.
It also evaluates the new version 1 contract separately. Legacy records lack the
necessary provenance and remain **inconclusive under this evaluator**. Stored
acceptance does not approve, apply, merge, or refactor anything.

```text
predeclared plan + one changed file + matched known nuisance/task identities
                              ↓
 repeated trial receipts + actual sink references + quality gate + median effect
                              ↓
 inconclusive | rejected | criteria-met (conditional descriptive result)
```

## Version 1 record

Each record includes the existing `id`, stored `status`, `baseline`, and
`candidate`. Add this `contract`:

```json
{
  "version": 1,
  "treatment": {
    "path": "skills/notify/SKILL.md",
    "beforeHash": "<64 lowercase hex characters>",
    "afterHash": "<different 64 lowercase hex characters>"
  },
  "declaredBeforeTrials": true,
  "planEvidenceRef": "receipts/predeclared-plan.json",
  "criteria": {
    "minimumTrials": 3,
    "minimumEffect": 0.2,
    "maximumQualityRegression": 0,
    "requireAllCandidatePass": true,
    "metric": "toolCalls"
  }
}
```

Hash placeholders above illustrate the format; they are not valid receipts.
The plan reference and declaration are recorded assertions. This evaluator does
not independently prove that a plan preceded execution.

Each side contains `architectureSnapshot` from `captureArchitecture(root)` and
its `architectureVersion`. Snapshot scope is `complete-declared-root`; its `files`
map includes every relative path and SHA-256 in that root. Baseline and candidate
must differ in exactly the declared path and hashes. A skill, agent, reference,
or architecture configuration file can be the treatment. Overall architecture
and execution configuration hashes may differ because the treatment changes
them. Additional file drift fails validation. The caller must select a complete,
non-secret architecture root; this is not an assertion about files outside it.

Each side also contains a complete `identity` with known string values for:

| Identity | Required meaning |
| --- | --- |
| `modelRequested`, `modelActual`, `provider` | Requested and observed execution model/provider, not a friendly profile alias |
| `runtime` | Pinned runtime/version |
| `tools`, `mcp` | Full effective tool and MCP sets/configuration, including an explicit `none` when empty |
| `settings` | All unchanged execution settings, excluding only the declared file treatment |
| `task`, `dataset`, `grader` | Pinned task, input/holdout data, and actual output grader identity |

All these nuisance/task fields must match exactly. Unknown, partial, or omitted
identities fail closed. Do not substitute a matching arbitrary user hash for the
actual identity. `identityEvidence` requires `completeness: "authoritative"`,
`verification: "caller_asserted"`, and an evidence `ref`. These labels deliberately
retain the distinction between a full caller assertion and independent proof.
They are not upgraded by matching hashes.

Each side's `trialEvidence` contains every attempted trial, including failures.
A trial needs a globally unique `runId`, boolean `passed`, matching actual
`identity`, finite nonnegative selected metric, and a nonempty `sinkEvidenceRefs`
array naming actual graded output artifacts. References are displayed as recorded
metadata, not blindly opened links. Their existence, grader correctness, capture
completeness, and whether all attempts were retained still require external
inspection. An asserted reference alone does not prove an artifact exists.

## Local API and limits

`agentops-cli/src/lib/architecture/experiment-contract.js` exports:

- `captureArchitecture(root)`: derives hashes from local files; rejects symlinks,
  empty roots, unsupported entries, more than 1,000 files/directories, directory
  nesting beyond 16 levels, or more than 1 MiB of total content.
- `validateExperiment(record, {baselineRoot, candidateRoot})`: checks the contract;
  when both optional roots are supplied, recomputes their files and rejects drift.
  Runtime/task identities remain caller assertions even after local file proof.
- `evaluateExperiment(record, options)`: validates then evaluates repeated trials.

Records are bounded to 1 MiB; sides to 1,000 trials; each trial to 20 sink refs.
Minimum sample is predeclared and at least two trials per side. Allowed lower-is-
better metrics are `toolCalls`, `durationMs`, `inputTokens`, and `outputTokens`.
The effect threshold is greater than zero and at most one. The metric must have
comparable units and scope in all trial receipts; missing usage cannot become zero.

The evaluator first rejects a candidate failed task or quality regression. A
failed baseline is inconclusive. Only after quality passes does it compare median
metrics: `(baselineMedian - candidateMedian) / baselineMedian`. An inadequate
sample, zero baseline, missing sink refs, duplicate run, model mismatch, or
insufficient effect stays inconclusive. Passing descriptive criteria returns
`criteria-met`, **conditional on caller assertions**, with `authorization: "none"`.
No p-value, statistical significance, general improvement, or automatic acceptance
is inferred from a small cohort. Independent evidence review remains necessary.
