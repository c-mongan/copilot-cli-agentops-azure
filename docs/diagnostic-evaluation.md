# Diagnostic evaluation and held-out StockPilot preparation

Status: local fixture tooling, not a demonstrated usefulness improvement. No new participant, model, customer, cloud or production execution is required by these commands. The diagnostic harness complements [the usability study kit](usability-study-kit.md), whose setup, privacy and navigation questions remain separate.

```text
seed → public synthetic stimuli → isolated trial presentation → collected response
     → external protected key → cause/component/evidence grade → accuracy first
seed → generated StockPilot data → pinned Vally spec (not executed)
     → external protected key → actual JSONL sinks → replayable task-quality receipt
```

## Local zero-model rehearsal

Run these commands from the repository root. Choose a new absolute external directory; its parent must already exist.

```sh
node evals/diagnostics/benchmark.js --help
node evals/stockpilot/scripts/heldout.js --help
node evals/diagnostics/smoke.js /tmp/new-agentops-fixture-rehearsal fresh-fixture-seed
node --test evals/diagnostics/test/*.test.js evals/stockpilot/test/*.test.js
```

`smoke.js` creates public bundles, external keys, fixture responses, real synthetic sink files and graded receipts. It deliberately reads the answer keys to produce oracle fixture answers. Every identity is `fixture`; this validates plumbing only. Its zero elapsed times are excluded from diagnosis-time statistics. It makes no claim about a model's accuracy or a person's time saved. It does not start Vally or Copilot, install dependencies, or contact a service.

Output paths must be new. Answer-key JSON files have mode `0600`, remain outside the repository and public bundle, and are never included in Vally `agent_environment.files`. Keep their parent directory private. These filesystem conventions are not an isolation boundary for an agent running as the same operating-system user: future live trials need a separate user/container/filesystem policy that actually denies key access. Keep the key, records and answer-aware grader outside participant/model workspaces. Do not publish a seed or answer-aware rehearsal before testing its held-out dataset. Generate a fresh seed for the actual evaluation.

## Controlled diagnostic study

Create separate public and protected-key parent directories, then prepare an even number of pseudonymous participants:

```sh
node evals/diagnostics/benchmark.js prepare private-fresh-seed /path/to/public/new-bundle /path/to/protected/new-key.json 6
node evals/diagnostics/benchmark.js grade /path/to/public/new-bundle/stimuli.json /path/to/protected/new-key.json /path/to/collected-responses.json
```

The seeded generator creates two distinct incidents for each of six cases: a missing required reference, an MCP tool error, a different observed model from the requested model, a script failure, a healthy control and a capture gap where diagnosis is unknown. It changes component, reference/script, run, event and model identifiers. The process may exit zero while the task fails. Absence of complete capture never establishes healthy execution.

Each participant receives twelve incidents, six per condition. Every individual incident appears as native evidence for half the participants and AgentOps evidence for half. Twins use opposite conditions within a participant, so nobody sees the same incident twice. A seeded shuffle varies order. Trial instructions ask for the cause, affected component and supporting source event reference. Matching all three is necessary for correctness.

**Deliver only one scheduled `trials/<trialId>.json` at a time.** The `stimuli.json` master and schedules are facilitator materials; exposing the master lets a participant read both evidence conditions. Trial files contain only their assigned presentation. The fixture AgentOps presentation preserves the same source facts and adds ordered source references; it is not a rendered AgentOps UI or captured real incident. This experiment scaffolding must be replaced or extended with representative captured/UI evidence before claiming product usefulness.

Responses are a JSON array. Unknown/partial model provenance is rejected and cannot enter timing comparisons. The runtime rejects unexpected top-level and identity fields, unknown/duplicate trials, unknown event references, missing provenance and invalid timings. It records no names, transcripts, prompts, code or tool payloads. Each response contains:

| Field | Contract |
| --- | --- |
| `trialId` | Exact scheduled opaque trial reference |
| `identity.participantRef` | Exact assigned `participant-0001` style reference |
| `identity.kind` | `human`, `model`, or `fixture` |
| `identity.sessionRef` | Opaque reference; no identity information |
| Human provenance | `identity.consentConfirmed: true`; actual consent remains outside this repository |
| Model provenance | `requestedModel`, `observedModel`, `runtimeVersion`, `modelEvidenceRef`; observed model must come from an independent runtime receipt, not the requested setting |
| `outcome` | `completed`, `failed`, or `unknown` |
| `cause` | One of the six `responseCauses` in the trial |
| `component` | Opaque affected component from the evidence |
| `sourceEventRefs` | Supporting event IDs from that incident |
| `startedAt`, `endedAt` | Real collected UTC date-time values |
| `elapsedMs` | Exact nonnegative difference between collected timestamps |
| `helpRequests`, `setupEffortMs` | Nonnegative integers; measure setup separately from diagnosis |

No automated command collects a real participant response. A facilitator must start the timer at presentation, end it at answer submission/timeout, preserve failure and unknown answers, and independently confirm consent/provenance. Merely filling JSON with `kind: human` proves no human participation. Reports explicitly describe provenance as reported.

Predeclare diagnostic accuracy as the primary measure. All assigned trials remain in its denominator, including missing, failed and unknown responses. Report success/failed/unknown counts by condition before discussing time. Diagnosis-time medians include correct answers with compatible human/model identity only; fixture timings and mismatched requested/observed models are excluded. Report help requests and setup effort separately. Overall accuracy is descriptive and includes all reported identities; for an actual comparison, use a homogeneous participant cohort and review each row's `comparisonEligible` flag. Never infer savings from fewer successful respondents, oracle fixture output or made-up timestamps.

This small pilot has no inferential statistical test or stopping rule implemented. Predeclare a sample size, timeout, acceptable quality margin, exclusion rules and analysis before collection. Repeated investigators should use fresh incidents and retain condition/order balance. A follow-up with real participants and actual native/AgentOps evidence is required to establish diagnostic usefulness. Model investigators are a separate cohort, not a substitute for human usability evidence.

## Held-out StockPilot task preparation

```sh
node evals/stockpilot/scripts/heldout.js prepare private-fresh-seed /path/to/public/new-stockpilot /path/to/protected/new-stockpilot-key.json gpt-5.4-mini
```

Preparation writes `eval.json`, generated `data/dataset.json`, and `plan.json`. The plan carries task, dataset, spec and grader SHA-256 identities, the requested model, the existing Vally `0.17.0` executor pin, one worker, one run and zero retries. The command array is a template and is never executed by this script. Vally schemas can be checked locally:

```sh
VALLY_TELEMETRY_OPTOUT=1 DO_NOT_TRACK=1 evals/stockpilot/node_modules/.bin/vally lint --eval-spec /path/to/public/new-stockpilot/eval.json --verbose
```

The spec inherits the existing `regression` type without a baseline. Vally warns that this is a capability evaluation; that is the honest scope. It is not a baseline/candidate efficiency comparison. Generated tasks stage only owned StockPilot skills, existing synthetic fixture files and the new synthetic dataset; MCP is disabled for these sink-focused tasks. This reuses the pinned executor instead of adding an alternative executor or any dependency.

Three new task instances cover cheapest eligible supplier selection, cycle-count adjustment and exact low-stock notifications. The data, requested quantity and count change with the seed; identifiers and task text are hashed. Exact expected actions stay only in the external key. Reusing the generator's known three templates does not prove novel task-family generalization or secrecy from a model that can reconstruct disclosed seeds. Use unseen seeds/data and retain the key isolation boundary for live trials. Existing MCP success/failure and delegation experiments remain separate semantic-contract evaluations.

## Authoritative actual-sink grading

After a future authorized serial Vally run, normalize the retained execution records into a JSON array. Preserve Vally's `stimulus`, `workspacePath`, `status` and `trajectory` fields; add an independently obtained `runId`, matching `specHash`/`taskHash` and explicit `provenance`:

```json
{
  "kind": "observed-vally",
  "runtimeVersion": "opaque-runtime-version",
  "observedModel": "actual-runtime-model",
  "modelEvidenceRef": "opaque-independent-runtime-receipt"
}
```

`modelEvidenceRef` is a join reference, not proof by itself. The local sink grader checks that provenance is present and compatible, but does not fetch or independently authenticate it. Preserve the underlying runtime/export evidence and use a separate evidence join to qualify actual execution. Do not derive `observedModel` from the Vally requested setting. Required model/runtime/receipt references must be bounded nonblank known strings; object, boolean and unknown/partial placeholders cannot qualify a trial. Missing model/runtime/spec/task identity returns `unknown` even when sinks are correct; wrong actual model returns `failed`.

```sh
node evals/stockpilot/scripts/heldout.js grade /path/to/records.json /path/to/protected/new-stockpilot-key.json /path/to/approved-synthetic-workspaces
```

The authoritative grade reads bounded actual staged datasets and `purchase_orders.jsonl`, `outbox.jsonl`, and `erp_writes.jsonl`. It checks exact action sets and values, rejects unexpected/duplicate writes, invalid JSON, changed datasets, oversized artifacts and symlink/path escape, and requires each task and unique run exactly once. Empty sinks are valid only when the exact expected action set is empty. A textual promise of a write cannot pass. Timing/output marker text is not a task-quality oracle.

Receipt fields are `schemaVersion`, `evidenceTier`, `runId`, `taskId`, `taskHash`, `specHash`, `recordHash`, `outputHash`, `datasetHash`, `graderHash`, `status`, `passed`, `model`, `sourceArtifacts`, `sourceEventRefs`, `reason`, and successful `executionProvenance`. Artifact receipts include canonical path, SHA-256, bytes and role. No event reference is invented; exact ledger joins remain separate proof. Receipt tiers distinguish fixture sink grades from reported synthetic execution records.

The exported `verifyHeldoutReceipt(receipt, {keyFile, recordsFile, workspaceRoot})` replays the committed grader against retained key, execution record and actual artifacts. `verified` means the receipt exactly matches that replay, independently of whether task correctness passed. `independentlyVerifiedExecution` remains `false`. A modified key/grader/dataset/output/receipt does not silently establish an independently observed model execution. Product-evidence qualification must retain that scope and require separate runtime joins where live proof is needed.

No live runner, live model access check, participant recruitment/collection, rendered AgentOps comparison, repeated baseline/candidate confirmation, hosted deployment or customer-outcome claim is performed by this tooling.
