# Full Requirements: Agent Observability, Evaluation and Architecture Improvement System

## 1. Core problem

We have complex AI-agent workflows built around GitHub Copilot, VS Code custom agents, Copilot CLI, Agent Skills, references, scripts, MCP tools, subagents and automated execution.

As these systems grow, the architecture becomes difficult to reason about.

Typical questions become hard to answer:

- Why did this run fail?
- Which agent actually handled the task?
- Why was a particular subagent invoked?
- Which skills were loaded?
- Which reference files were actually used?
- Which tools were called?
- In what exact order were those tools called?
- How long did each operation take?
- Did anything retry or loop?
- Did the agent repeatedly reread the same file?
- Did a script fail internally?
- Did context become too large?
- Did context compaction affect quality?
- Did progressive disclosure help or merely create indirection?
- Are two skills actually one capability?
- Should a skill become a reference?
- Should reference material move into `SKILL.md`?
- Should reasoning become deterministic code?
- Is a subagent adding meaningful capability or merely latency?
- Did a refactor make the architecture objectively better?

Today these questions are often answered manually by inspecting prompts, agent files, transcripts and intuition.

That does not scale.

---

# 2. Overall goal

Build an **end-to-end agent observability and architecture-intelligence system**.

It should function as:

1. **Flight recorder** — reconstruct what happened.
2. **Profiler** — identify latency, token, tooling and orchestration inefficiencies.
3. **Architecture mapper** — understand agents, skills, references, tools, scripts and relationships.
4. **Failure-analysis system** — identify recurring failure modes.
5. **Evaluation platform** — test architecture changes objectively.
6. **Architecture reviewer** — suggest evidence-backed improvements.
7. **Experiment engine** — test proposed changes safely.
8. **Continuous improvement loop** — progressively improve the agent system over time.

The desired loop is:

```text
Agent executes
      ↓
Full structural telemetry
      ↓
Trace reconstruction
      ↓
Cross-run analytics
      ↓
Failure / inefficiency detection
      ↓
Architecture hypothesis
      ↓
ONE bounded candidate change
      ↓
Evaluation
      ↓
Baseline vs candidate
      ↓
Accept / reject
      ↓
Repeat
```

### Why

Agent architectures are nondeterministic systems.

Refactoring them based purely on intuition makes it easy to:

- fix one case and break another;
- over-split workflows;
- over-merge skills;
- increase context unnecessarily;
- introduce routing ambiguity;
- create hidden regressions.

Changes should therefore be driven by measured behavior.

---

# 3. Microsoft-first requirement

The system should be built primarily from Microsoft/GitHub/Azure technology.

Preferred stack:

```text
GitHub Copilot
VS Code
Copilot CLI
GitHub Custom Agents
Agent Skills

OpenTelemetry

Azure Monitor
Application Insights
Log Analytics
Azure Managed Grafana

Azure MCP Server

Microsoft Vally
Microsoft SkillOpt

Azure OpenAI if semantic analysis is required

Bicep / Azure Developer CLI
GitHub Actions / Azure DevOps where appropriate
```

Third-party systems may be researched for ideas, but the production architecture should avoid depending on an external observability SaaS unless a genuine capability gap exists.

### Why

This system may observe:

- proprietary source code;
- internal agent instructions;
- operational tooling;
- tool arguments;
- traces;
- potentially sensitive prompts.

Keeping infrastructure within Azure simplifies:

- governance;
- security;
- identity;
- RBAC;
- integration;
- operational ownership.

---

# 4. Scope of supported agent execution

The system should support all major local Copilot execution modes.

## Required

### Direct custom-agent selection

```text
User
 ↓
selects CustomAgent
 ↓
CustomAgent executes
```

### Automatic custom-agent invocation

```text
Parent Agent
 ↓
routes/delegates
 ↓
CustomAgent
```

### Nested agents

```text
Agent A
 ↓
Agent B
 ↓
Agent C
```

### Copilot CLI

Both normal interactive and automated execution.

### VS Code Copilot agent mode

Including custom-agent workflows.

### Autopilot/non-interactive workflows

Where supported by the current runtime.

### Skills

Including progressive loading.

### MCP tools

### Native Copilot tools

### Shell commands

### Python scripts

### TypeScript/Node scripts

### Other deterministic helpers

### Why

The observability model must reflect the **entire workflow**, not only the LLM portions.

---

# 5. Cloud-agent support should be capability-based

GitHub-hosted/cloud execution should be researched separately.

Do not assume:

```text
local VS Code telemetry
==
remote GitHub cloud-agent telemetry
```

Create an explicit compatibility matrix.

For each runtime classify support as:

```text
FULL
PARTIAL
METADATA ONLY
CUSTOM ADAPTER REQUIRED
UNAVAILABLE
UNKNOWN
```

### Why

A system that silently presents incomplete cloud traces as complete would produce incorrect architecture analysis.

---

# 6. Instrument repo-wide, not just one target agent

Default architecture should instrument the **whole agent system**.

Capture structural telemetry for:

```text
all custom agents
all relevant subagents
skills
references
tools
scripts
model activity
```

Then filter downstream.

### Why

A major failure mode may be:

> The target agent did not run.

If only the expected agent is monitored, incorrect routing becomes invisible.

For example:

```text
Expected:
Agent A

Actual:
Agent B
```

is itself valuable evidence.

---

# 7. But support scoped analysis

Although collection is repo-wide, users should easily filter:

```text
agent.name == pipeline-debugger
```

or:

```text
architecture.version == 24
```

or:

```text
workflow.run_id == XYZ
```

### Why

Full instrumentation should not mean analysts have to manually sift through irrelevant telemetry.

---

# 8. One run must be reconstructable end-to-end

Every user task should receive a stable logical identifier:

```text
workflow.run_id
```

A completed run must be reconstructable into something like:

```text
User request
│
└── Agent: pipeline-debugger           42.8s
    │
    ├── Model call                      2.8s
    │
    ├── Skill: diagnose-build
    │   │
    │   ├── Reference: evidence.md
    │   │
    │   ├── Tool: get_build             0.7s
    │   │
    │   ├── Tool: get_timeline          1.1s
    │   │
    │   └── Tool: get_logs              4.3s
    │
    ├── Script: parse_logs.py           6.8s
    │   ├── load                        1.0s
    │   ├── normalize                   1.4s
    │   ├── classify                    3.7s
    │   └── serialize                   0.7s
    │
    ├── Subagent: regression-worker    13.4s
    │   ├── Skill: last-green
    │   ├── Tool: git-diff              1.8s
    │   └── Model call                  4.7s
    │
    └── Final response
```

### Why

The run should behave like a distributed trace rather than a collection of unrelated logs.

---

# 9. Exact ordering is mandatory

Capture the exact chronological order of:

```text
agent invocation
model calls
skill activations
reference reads
tool calls
script invocations
subagent invocations
errors
retries
compaction
completion
```

### Why

Order frequently explains failures.

Example:

```text
get_logs
get_logs
get_logs
search
get_logs
search
```

may reveal agent thrashing even though every individual tool call succeeded.

---

# 10. Agent telemetry requirements

For every agent invocation capture:

```text
agent.id
agent.name
agent.type
agent.version

parent.agent
child agents

invocation mechanism

start time
end time
duration

status
stop reason

model requested
model used

turn count

input tokens
output tokens
cached tokens

tool count
skill count
subagent count

errors

session ID
conversation ID
workflow.run_id
```

Where available also record:

```text
context usage
compaction
truncation
```

### Why

This forms the fundamental unit for comparing agent versions and architectures.

---

# 11. Tool telemetry requirements

Every tool invocation must capture:

```text
tool.name
tool.type
tool.server

tool.call_id

sequence_number

parent.agent
parent span/tool

start
end
duration

result status

error
timeout
cancellation

retry count where identifiable

safe argument metadata
safe output metadata
```

### Why

Tool behavior is one of the strongest signals for agent architecture problems.

---

# 12. Tool sequence analysis

The system must later answer:

- Which tools are slowest?
- Which tools fail most?
- Which are retried?
- Which are repeatedly called with near-identical arguments?
- Which tool sequences correlate with successful runs?
- Which sequences correlate with failure?
- Where does the agent bounce between tools?
- Are expensive tools being used unnecessarily?

### Why

A tool can individually work perfectly while the agent uses it badly.

---

# 13. Skill telemetry

Track every skill activation.

Capture:

```text
skill.name
skill.path
skill.version/hash

agent
workflow.run_id

activation timestamp

activation count
```

Derive:

```text
runs using skill
P(skill B | skill A)

success rate when used
failure rate when used

average tokens
average latency

average references loaded
average tools used
```

### Why

This allows architecture decisions to be based on observed skill usage.

---

# 14. Skill co-activation analysis

Generate a co-activation matrix.

Example:

```text
                       A      B      C
diagnose             --     .94    .12
classification       .94     --     .09
last-green           .12    .09     --
```

### Why

If A and B almost always run together, one may merely be an artificial workflow boundary.

This does **not automatically mean merge them**.

It means:

> investigate whether they represent separate intents.

---

# 15. Reference observability

This is a major custom requirement.

Track which reference files were actually read.

Capture:

```text
reference.path
reference.name
reference.hash
reference.size

parent.skill
parent.agent

workflow.run_id

timestamp

number of reads
```

### Why

Progressive disclosure cannot be evaluated unless we know what is actually being progressively disclosed.

---

# 16. Do not require reference content to be uploaded

STANDARD telemetry should be able to record:

```text
references/evidence.md was read
```

without recording:

```text
the contents of evidence.md
```

### Why

We need structural observability without turning normal telemetry into source-code exfiltration.

---

# 17. Reference usage analytics

Calculate:

```text
P(reference X | skill A)

references / run

rereads / reference

reference byte/token approximation

success correlation

failure correlation
```

### Why

These metrics can identify whether progressive disclosure is helping.

---

# 18. Reference architecture insights

The system should eventually detect candidates such as:

### Reference may belong in core skill

```text
Reference X is loaded in 96% of skill A runs.
```

Possible conclusion:

> Core routing/decision information may belong directly in `SKILL.md`.

---

### Healthy progressive disclosure

```text
Reference Y loads in 14% of runs,
almost entirely when branch Y is required.
```

Possible conclusion:

> This reference boundary is useful.

---

### Reference may be redundant

```text
Reference Z is loaded in 2% of runs,
contains mostly duplicated instructions,
and removing it does not hurt evals.
```

Possible conclusion:

> Remove it.

---

# 19. Do not use document length as the main architecture rule

The optimizer must not implement simplistic logic such as:

```text
if skill > 500 lines:
    split
```

Length can be a weak signal.

Architecture decisions should primarily depend on:

```text
intent
activation patterns
conditional use
instruction dependencies
context cost
failure patterns
eval outcomes
```

### Why

One cohesive 600-line capability may be cleaner than five 120-line skills that always execute together.

---

# 20. Skill versus reference decision model

A **skill** should generally correspond to:

> an independently meaningful capability or job-to-be-done.

A **reference** should generally correspond to:

> knowledge needed by a capability under particular conditions.

The analysis engine should ask:

```text
Can this capability be invoked independently?

Does it have its own inputs/outputs?

Does it have distinct success criteria?

Would a user naturally request it independently?

Does it frequently execute without the parent skill?
```

If not, it may not deserve to be an independent skill.

---

# 21. Control-plane versus knowledge-plane distinction

`SKILL.md` should generally contain information necessary to answer:

> What should I do next?

References should contain information needed after the system knows:

> I am doing branch X.

### Why

This provides a principled way to manage progressive disclosure.

The root skill is the **control plane**.

References are the **knowledge plane**.

---

# 22. Avoid progressive indirection

The system should detect patterns like:

```text
Skill A
 ↓
reference A
 ↓
Skill B
 ↓
reference B
 ↓
Skill C
```

when they represent one logical workflow.

### Why

Progressive disclosure is good.

Progressive **indirection** can create:

- routing overhead;
- unnecessary model decisions;
- context fragmentation;
- debugging difficulty.

---

# 23. Scripts need first-class tracing

Any meaningful code executed by the workflow should be instrumented.

Required initially:

```text
Python
TypeScript/Node
```

Potentially later:

```text
PowerShell
shell
.NET
```

Capture:

```text
script.name
script.version
workflow.run_id

start/end
duration

exit status
exception

internal spans

external requests
```

### Why

Otherwise:

```text
execute_shell = 19 seconds
```

does not tell us whether:

```text
download = 2s
parsing = 3s
API = 13s
```

caused the problem.

---

# 24. Use the same telemetry backend for scripts

Agent telemetry and script telemetry should enter the same OTel/Azure pipeline.

Desired:

```text
Copilot
   │
   ├── agent spans
   ├── model spans
   └── tool spans
         │
         └── script
              ├── parse
              ├── fetch
              └── classify

               ↓

same Application Insights / Log Analytics environment
```

### Why

We want one execution graph, not separate monitoring products.

---

# 25. Trace propagation into subprocesses must be investigated

Research whether Copilot propagates standard W3C:

```text
traceparent
tracestate
```

into arbitrary shell child processes.

Do not assume this.

### Preferred case

```text
execute_tool
  └── script
       └── internal span
```

### Fallback

If physical trace propagation is impossible:

```text
Copilot trace ──┐
                ├─ workflow.run_id
Script trace ───┘
```

### Why

Logical correlation is more important than pretending unsupported trace inheritance exists.

---

# 26. Instrumented script runner

Prefer one wrapper:

```text
agentobs-run
```

rather than duplicating instrumentation setup.

Example:

```text
agentobs-run python scripts/analyze.py
```

The wrapper should automatically configure:

```text
workflow.run_id
OTel endpoint
service name
script name
git SHA
architecture version
telemetry mode
```

### Why

Observability should not become boilerplate scattered across every script.

---

# 27. OpenTelemetry should be the common language

Use standard OpenTelemetry semantic conventions whenever possible.

Do not invent custom fields for information already standardized.

Custom attributes should be limited to architecture-specific information such as:

```text
workflow.run_id

architecture.version

skill.name
skill.version

reference.path

script.name

experiment.id
eval.case.id
```

### Why

This maximizes compatibility with:

- Copilot;
- Azure;
- VS Code;
- standard OTel tooling;
- future agent runtimes.

---

# 28. Collector-centered architecture

Preferred telemetry path:

```text
Copilot / VS Code ─┐
                   │
Python / Node ─────┤
                   │
Eval runner ───────┤
                   ▼
             OTel Collector
                   │
           sanitize / enrich
           batch / sample
                   │
                   ▼
          Azure Application Insights
                   │
              Log Analytics
                   │
       ┌───────────┼────────────┐
       ▼           ▼            ▼
 Agent View      Grafana       MCP
                                │
                                ▼
                    Architecture Analyzer
```

### Why

One gateway provides one place to manage:

- filtering;
- sensitive data;
- schemas;
- enrichment;
- sampling;
- export.

---

# 29. Azure backend requirements

At minimum investigate/provision:

```text
Log Analytics Workspace

workspace-based Application Insights

Azure Managed Grafana

Managed Identity

Key Vault
```

Potential later components:

```text
Container Apps Jobs
Storage
Azure OpenAI
```

### Why

Start with the smallest infrastructure required for reliable telemetry.

---

# 30. Local-first observability

Developers must be able to inspect traces locally without Azure.

Investigate/use:

```text
VS Code local OTel SQLite storage

OTel Collector

Aspire Dashboard
```

Desired development model:

```text
Copilot
   ↓
OTel
   ├── rich local trace
   └── sanitized Azure trace
```

### Why

Debug loops need to remain fast.

---

# 31. Three telemetry modes

## STANDARD

Always-on or broadly enabled.

Capture:

```text
agent names
models
tools
skills
reference paths
script spans

timestamps
durations

tokens
turns

errors
retries

architecture version
Git SHA
run ID
```

Do **not** capture by default:

```text
prompt content
response content
source contents
tool payloads
secrets
```

---

## EVAL

Used for controlled tests.

May additionally capture:

```text
prompt
agent instructions
model output
reference contents
tool arguments
tool results
workspace diff
grader output
```

---

## FORENSIC

Used for deliberately selected failures.

Capture sufficient semantic context to answer:

> Why did the model behave this way?

### Why

Metadata gives high-volume structural analysis.

Rich content gives low-volume semantic analysis.

We need both.

---

# 32. Not capturing prompts by default is deliberate

Metadata-only telemetry can identify:

```text
wrong routing
slow tools
tool loops
skill sprawl
reference sprawl
context pressure
subagent overhead
script failures
token waste
```

But it cannot reliably explain:

```text
instruction ambiguity
semantic contradiction
bad interpretation
reference usefulness
missing information
```

### Therefore

Use:

```text
many metadata traces
+
smaller high-quality rich eval traces
```

---

# 33. Security requirements

The observability system must assume agent traces may contain secrets.

Default centralized telemetry must not contain:

```text
API keys
auth tokens
environment secrets
full source files
private prompts
raw terminal output
private tool payloads
```

### Why

Agent observability can become an accidental data-exfiltration mechanism if designed carelessly.

---

# 34. Fail-closed filtering

Collector policy should prefer an explicit allow-list.

Unknown attributes should not automatically flow to Azure.

### Why

Future Copilot versions may add fields containing information we did not anticipate.

---

# 35. Entra identity

Prefer:

```text
Microsoft Entra ID
Managed Identity
RBAC
DefaultAzureCredential
```

over embedded connection secrets where supported.

### Why

This provides better credential lifecycle and auditing.

---

# 36. Sensitive-content testing

Add a test sentinel such as:

```text
AGENTOBS_DO_NOT_EXPORT_7FD92A
```

Trigger a run containing it.

In STANDARD mode the sentinel must not appear in:

```text
Application Insights
Log Analytics
Grafana
exported traces
```

### Why

Security should be verified, not assumed.

---

# 37. Static architecture analysis

Observability only tells us what executed.

Also scan the repository.

Inspect:

```text
.github/agents/
.github/skills/
.agents/skills/

SKILL.md

references/
scripts/

MCP configs
hooks
central config
```

Build a static graph:

```text
Agent
 ├── allowed tools
 ├── subagents
 ├── skills
 │    ├── references
 │    └── scripts
 └── MCP servers
```

### Why

We need both:

> what could execute

and:

> what actually executes.

---

# 38. Dynamic architecture graph

Generate a graph based on observed activity.

Example:

```text
pipeline-agent
│
├─ diagnose              97%
│   ├─ evidence.md       93%
│   └─ get-logs          87%
│
├─ classifier            94%
│
└─ regression-worker     38%
```

Percentages represent observed execution frequency.

### Why

This makes architectural coupling visible.

---

# 39. Combine static and dynamic graphs

Generate findings such as:

```text
Declared but never used

Frequently used but undeclared

Orphan reference

Unused script

Unexpected dependency

Near-mandatory optional reference

Agents that always delegate

Skills that never execute independently
```

---

# 40. Central configuration

Investigate native Copilot mechanisms first.

Where they are insufficient, create something like:

```text
.agentobs/config.yaml
```

for architecture-wide constants.

Example:

```yaml
project:
  name: pipeline-debugger

architecture:
  version: 17

telemetry:
  mode: standard

analysis:
  min_runs: 30

eval:
  framework: vally

optimizer:
  one_change_per_experiment: true
```

### Why

Configuration should not be duplicated across:

- custom-agent prompts;
- skills;
- references;
- scripts.

---

# 41. Investigate agent input variables/config

Research whether current GitHub Copilot/custom-agent/Agent Skills implementations provide native structured variables that can be referenced across agent instructions.

If no adequate mechanism exists, use a repo-level structured config plus tooling.

### Why

Repeated values inside Markdown create:

- drift;
- inconsistency;
- harder refactoring;
- harder experimentation.

---

# 42. Context-pressure observability

Capture/derive:

```text
input tokens

turn count

reference count

skill count

compaction events

truncation events
```

Analyze:

```text
P(failure | compaction)
P(compaction | N references)
P(failure | high skill count)
```

### Why

A progressively loaded architecture can still overwhelm context if every branch becomes active.

---

# 43. Detect thrashing

Automatically identify:

```text
same tool repeatedly called

same file repeatedly opened

same reference repeatedly opened

repeated searches with no new evidence

agent A → B → A loops

repeated script failures

many LLM turns with little new evidence
```

### Why

Thrashing is both an efficiency issue and often a sign of poor instructions or boundaries.

---

# 44. Failure taxonomy

Start with:

```text
WRONG_AGENT_ROUTING

WRONG_SKILL_ROUTING

UNNECESSARY_SKILL

MISSING_SKILL

REDUNDANT_REFERENCE

MISSING_REFERENCE

REFERENCE_CONFLICT

TOOL_FAILURE

TOOL_TIMEOUT

TOOL_THRASH

SCRIPT_FAILURE

SCRIPT_SLOW

UNNECESSARY_DELEGATION

SUBAGENT_FAILURE

CONTEXT_COMPACTION

CONTEXT_TRUNCATION

BAD_EVIDENCE

BAD_REASONING

BAD_FINAL_OUTPUT

NONDETERMINISTIC_FAILURE

UNKNOWN
```

### Why

Structured failure categories allow aggregate analysis.

---

# 45. Deterministic analytics before LLM analysis

Calculate metrics programmatically first.

Examples:

```text
tool frequency

tool repetition

skill coactivation

reference frequency

reference reread rate

subagent frequency

subagent latency contribution

token consumption

compaction frequency

architecture-version deltas
```

Then supply summarized evidence to an LLM.

### Why

Do not make an LLM rediscover basic statistics from thousands of raw traces.

---

# 46. Architecture insights engine

The system should eventually generate findings such as:

```text
Skill A and B coactivate in 94% of runs.

Reference X is loaded in 98% of parent skill runs.

Reference Y is loaded only during branch Y.

Agent C contributes 29% of latency.

Tool D accounts for 71% of retries.

Failed runs use a median of 7 skills;
successful runs use a median of 3.

Context compaction occurs in 22% of failures
but 4% of successes.
```

### Why

Raw observability alone does not solve the architectural problem.

---

# 47. Insights are hypotheses, not truth

Never automatically conclude:

```text
coactivation > 80%
therefore merge
```

Instead:

```text
coactivation > 80%
therefore investigate merge candidate
```

### Why

Two independently meaningful capabilities may legitimately be used together frequently.

---

# 48. Skill merge heuristic

Suggest investigation if:

```text
P(B | A) high
P(A | B) high

B has little independent use

A/B serve same user intent

success criteria overlap
```

### Why

This identifies likely artificial boundaries.

---

# 49. Skill-to-reference heuristic

Suggest when:

```text
component almost never runs independently

component mostly provides knowledge for parent capability
```

### Why

Not every reusable Markdown file needs its own routing surface.

---

# 50. Reference promotion heuristic

Suggest when:

```text
reference is loaded in nearly every parent-skill execution
```

but only promote the **essential control information**.

Do not blindly paste the entire reference into `SKILL.md`.

---

# 51. Deterministic-script heuristic

Suggest code when the model repeatedly performs mechanical transformations such as:

```text
parse
sort
extract
normalize
filter
calculate
compare
```

### Why

LLMs should not repeatedly spend tokens reproducing deterministic algorithms.

---

# 52. Subagent removal heuristic

Investigate when:

```text
subagent frequently runs

adds significant tokens/latency

produces predictable output

and removing it does not hurt eval quality
```

---

# 53. Subagent creation heuristic

Consider a separate agent when work:

```text
has a genuinely independent objective

benefits from isolated context

requires a distinct toolset

can happen in parallel

would otherwise pollute main-agent context
```

---

# 54. Do not optimize simply for minimum architecture size

The goal is NOT:

```text
fewest agents
fewest skills
fewest references
```

The goal is:

```text
maximum reliable capability

with

minimum unnecessary complexity
```

Sometimes the correct answer may be:

```text
split one skill
add another reference
create a new subagent
```

---

# 55. Evaluation framework

Use Microsoft Vally as the primary candidate evaluation system unless research identifies a blocker.

The eval system should support:

```text
trajectory inspection

tool-call graders

workspace-diff graders

deterministic graders

LLM graders

subagent-scoped evaluation

baseline vs candidate
```

---

# 56. Evaluation dataset

Start with real tasks.

Initial target:

```text
30–50 representative cases
```

Include:

```text
normal successes

historical failures

edge cases

different routing branches

tool failures

long-context cases

negative skill-trigger cases
```

### Why

Real workflow history is more valuable than a purely synthetic benchmark.

---

# 57. Protected holdout

Keep a hidden/immutable portion of the evaluation suite.

The optimization agent must not be allowed to modify:

```text
holdout prompts

expected outcomes

hidden graders
```

### Why

Otherwise self-improvement becomes self-grading.

---

# 58. Multiple runs where needed

Agent behavior is stochastic.

Important eval cases should support repeated trials.

Measure:

```text
mean
variance
failure rate
```

rather than assuming one pass/fail execution fully characterizes a change.

---

# 59. Trace-to-eval workflow

Any interesting production/development run should be convertible into an eval.

Desired:

```text
trace
 ↓
failure labeled
 ↓
sanitize
 ↓
add to eval dataset
 ↓
grader added
 ↓
regression test
```

### Why

The eval suite should become stronger every time the system fails in a new way.

---

# 60. Architecture experiments

Every refactor should be treated as an experiment.

Attach:

```text
experiment.id

architecture.version

skill.bundle.version

git.commit.sha
```

Compare:

```text
baseline
vs
candidate
```

---

# 61. One architectural change at a time

Default:

```text
max_changes_per_candidate = 1
```

Avoid simultaneously:

```text
merging skills
changing model
rewriting prompt
replacing tool
changing subagents
```

### Why

Otherwise we lose causal attribution.

---

# 62. Candidate proposal format

Every proposal must contain:

```text
OBSERVATION

EVIDENCE

HYPOTHESIS

PROPOSED CHANGE

EXPECTED BENEFIT

RISKS

EVALS EXPECTED TO IMPROVE

EVALS THAT MUST NOT REGRESS
```

### Why

This forces recommendations to be evidence-based.

---

# 63. Candidate isolation

Create experiments using:

```text
git worktree
```

or equivalent isolated checkout.

### Why

The optimizer should never modify the active architecture before validation.

---

# 64. Candidate pipeline

```text
architecture finding
        ↓
one candidate change
        ↓
isolated worktree
        ↓
lint
        ↓
unit/integration tests
        ↓
Vally evaluation
        ↓
baseline comparison
        ↓
security checks
        ↓
PASS / FAIL
```

---

# 65. Acceptance gate

A candidate should only pass if:

```text
no critical regression

core correctness does not regress

target metric improves

security checks pass

normal tests pass
```

Optimization priority:

```text
1. correctness
2. critical safety/reliability
3. latency
4. tokens/cost
5. architecture simplicity
```

### Why

A faster incorrect agent is not an improvement.

---

# 66. Rejected experiment memory

Persist failed ideas.

Example:

```text
experiments/rejected/
```

Store:

```text
hypothesis
change
results
reason rejected
```

### Why

The optimizer should not propose the same unsuccessful architecture every week.

---

# 67. Architecture reviewer

Build an analysis agent that receives:

```text
static architecture

dynamic architecture graph

aggregated telemetry

failure clusters

eval history

previous experiments
```

It should initially be read-only.

### Why

First prove that the reviewer produces useful evidence-backed analysis before letting it modify anything.

---

# 68. Architecture reviewer should query Azure

Use Azure MCP or equivalent Microsoft-native querying.

The reviewer should be able to ask:

```text
Analyze the last 200 runs of architecture v24.

Show:

top failure clusters

tool loops

skill coactivation

reference usage

subagent latency

context compaction

token anomalies
```

### Why

The optimizer should reason over actual data instead of static Markdown alone.

---

# 69. Separate evidence gathering from recommendation

Use a staged process:

```text
1. gather facts

2. aggregate

3. classify problems

4. form hypotheses

5. choose one candidate

6. evaluate
```

Not:

```text
raw traces
 ↓
"rewrite the architecture"
```

---

# 70. SkillOpt comes after architecture stabilization

Use Microsoft SkillOpt primarily for:

```text
improving skill wording/content
```

after the outer architecture is stable.

Conceptually:

```text
OUTER LOOP

agent / skill / reference / script boundaries


INNER LOOP

contents of individual skill
```

### Why

Optimizing skill text does not automatically determine whether the skill should exist as an independent architectural unit.

---

# 71. Automated operation

Eventually support:

## Per PR

```text
static architecture checks
lint
fast regression suite
```

## Nightly

```text
aggregate telemetry
failure clustering
architecture health report
candidate finding generation
```

## Manual deep optimization

```text
rich telemetry
full eval suite
candidate generation
SkillOpt
held-out testing
```

---

# 72. Do not auto-merge initially

Automation may:

```text
discover issue

generate candidate

create worktree

run eval

open PR
```

Initially it should **not automatically merge the PR**.

### Why

Agent-architecture optimization is still experimental and potentially high impact.

---

# 73. Architecture health report

Generate regularly.

Include:

```text
architecture version

run count
success rate

failure clusters

agent usage

skill usage

reference usage

tool health

script health

context health

cost/token trends

latency trends

possible architectural issues

recent accepted experiments

recent rejected experiments
```

---

# 74. Required dashboard — run view

For a single run show:

```text
chronological waterfall

agent hierarchy

tools

skills

references

scripts

errors

tokens

model calls

context events
```

This should be the main debugging screen.

---

# 75. Required dashboard — agent view

Per agent:

```text
runs
success
failure
latency
tokens
turns
tools
skills
subagents
```

---

# 76. Required dashboard — tools

Show:

```text
call count
failure rate
p50
p95
retries
repeated-call rate
```

---

# 77. Required dashboard — skills

Show:

```text
activation rate
independent activation rate
coactivation
success correlation
tokens
latency
references loaded
```

---

# 78. Required dashboard — references

Show:

```text
load percentage
parent skill
reread rate
success/failure correlation
estimated context contribution
```

---

# 79. Required dashboard — scripts

Show:

```text
calls
duration
errors
internal bottlenecks
external dependencies
```

---

# 80. Required dashboard — architecture comparison

Example:

```text
                   v23       v24

Success            88.3%     92.1%
Tokens             29k       23k
Tool calls         18.2      13.1
Skills/run          5.1       3.0
Refs/run            7.0       3.4
P95 latency         91s       66s
Compaction          11%        4%
```

### Why

This is how refactoring becomes measurable.

---

# 81. Architecture graph UI

Visualize:

```text
Agent
 ├─ Skill
 │   ├─ Reference
 │   └─ Script
 ├─ Tool
 └─ Subagent
```

Edges should expose observed probabilities.

Example:

```text
P(classifier | diagnose) = 94%
```

---

# 82. User feedback

Allow developers to label runs:

```text
good

bad

partially correct

wrong diagnosis

wrong tool

wrong agent

too slow
```

### Why

Human corrections provide extremely valuable supervised signals.

---

# 83. Capture correction events

When someone corrects an agent:

```text
"No, this is wrong because..."
```

record at minimum:

```text
run required correction
```

Rich/eval mode may retain correction content.

### Why

Corrections should become regression candidates.

---

# 84. Public benchmark suite

Do not validate only using the user's complicated workflow.

Research and use public agents such as those in:

```text
github/awesome-copilot
```

Find examples covering:

```text
simple agent

tool-heavy agent

skill-heavy agent

multi-agent orchestration

deep subagents

script-heavy workflows
```

Potential candidates to investigate:

```text
RUG orchestrator

GEM orchestrator
```

### Why

This tests whether the observability system generalizes beyond one repository.

---

# 85. Observability compatibility tests

For every benchmark assert:

```text
root agent detected

child agent detected

ordering correct

tool timing captured

errors captured

skills captured

references captured

scripts captured

tokens captured

architecture version captured

standard mode doesn't leak content

rich mode captures controlled content
```

---

# 86. Build-versus-reuse requirement

Before implementation, research exactly which pieces are:

```text
native Copilot

native VS Code

native Azure

existing Microsoft OSS

small adapter

major custom implementation
```

Produce a matrix.

Example:

| Capability | Native | Custom? |
|---|---:|---:|
| agent spans | likely | |
| tool spans | likely | |
| token metrics | likely | |
| skill activation | likely | |
| reference reads | | likely |
| script spans | | instrument |
| architecture graph | | yes |
| architecture recommendations | | yes |
| regression eval | Microsoft framework | configuration |
| skill optimization | Microsoft framework | integration |

### Why

Do not build something Microsoft already provides.

---

# 87. Research before implementation

First agent should be a **research agent**, not a coding agent.

It should deeply inspect:

```text
GitHub Copilot docs

Copilot CLI docs

VS Code docs

Agent Skills specification

Microsoft Learn

OpenTelemetry GenAI semantic conventions

Microsoft repositories

Vally

SkillOpt

hve-core

Scope or newer Microsoft experiments

Awesome Copilot

strong external observability products for inspiration
```

---

# 88. Research should inspect source code

Do not stop at README files.

Where relevant inspect:

```text
schemas

Collector configs

example dashboards

actual code

hook examples

IaC templates

telemetry processors

Vally implementation

SkillOpt integration
```

### Why

Documentation may omit implementation details important to the architecture.

---

# 89. Research should run experiments where docs are unclear

Examples:

```text
direct agent invocation

delegated custom agent

skill invocation

reference read

Python subprocess

content capture on/off

context compaction
```

Record:

```text
setup

version

expected

observed

conclusion
```

---

# 90. Existing observability startups/products should be studied

Even though the solution should remain Microsoft-native, research:

```text
Braintrust

Arize/Phoenix

Langfuse

LangSmith

Traceloop/OpenLLMetry

other strong 2026 systems
```

Do this to discover useful product ideas such as:

```text
automatic failure clustering

semantic trace search

production → eval workflows

dataset generation

trace comparison

automated insights
```

### Why

Azure should be the infrastructure choice, but there is no reason to reinvent product-design lessons poorly.

---

# 91. Automated failure discovery

Research/build techniques including:

```text
statistical aggregation

sequence analysis

clustering

embedding clustering

LLM-assisted classification

anomaly detection
```

Prefer deterministic analysis where possible.

Use an LLM where semantics are required.

---

# 92. Sequence model

Preserve a canonical ordered event stream:

```text
1 agent start

2 model call

3 skill A

4 reference A

5 tool X

6 tool X

7 tool Y

8 subagent B

9 tool Z

10 completion
```

### Why

Sequence analysis enables detecting architectural loops and thrashing.

---

# 93. Storage considerations

Telemetry volume may be high.

Support:

```text
sampling

retention

aggregation

attribute limits
```

But preferentially retain:

```text
100% failures

100% eval runs

100% architecture experiments
```

Sample routine successes only if necessary.

---

# 94. Source/version tagging

Every run must identify:

```text
git.commit.sha

git.branch

architecture.version

skill.bundle.version

experiment.id

environment
```

### Why

Otherwise comparisons across architecture revisions become unreliable.

---

# 95. Architecture versioning

Increment a logical:

```text
architecture.version
```

for meaningful architecture changes.

Do not rely solely on commit SHA.

### Why

Architecture-level reporting should remain human-readable.

---

# 96. Definition of “better”

Do not collapse everything into a single score initially.

Use ordered constraints:

## Primary

```text
task correctness
```

## Hard constraint

```text
no new critical failures
```

## Secondary optimization

```text
latency

token cost

tool count

agent count

context pressure

architecture complexity
```

---

# 97. Example desired insight

The finished system should be capable of producing:

```text
Observation

diagnose-build and failure-classification coactivate in
94.1% of runs.

failure-classification runs independently in 2.8%.

The classification reference is loaded in 89% of those runs.

Failed runs have 1.8× more total skill activations.

Hypothesis

These components likely represent one user capability and the
current routing boundary adds unnecessary complexity.

Candidate

Move classification control logic into diagnose-build.

Retain uncommon classifier edge cases as a conditional reference.

Experiment

Baseline v23 vs candidate v24.

Result

Success            +3.7pp
Tokens             -16%
Latency            -13%
Skills/run          -1.2
Critical failures    unchanged

Decision

Candidate passes regression gate.
```

---

# 98. Example desired opposite conclusion

It must also be able to say:

```text
Skill A and B frequently coactivate.

However:

B executes independently in 47% of B runs

B has separate success criteria

B uses a different toolset

B performs well independently

Conclusion

Keep A and B separate.

Coactivation alone is insufficient evidence for merging.
```

### Why

The system must not optimize blindly toward monoliths.

---

# 99. Example progressive-disclosure conclusion

```text
Reference Kubernetes-Troubleshooting.md loads in only 11%
of runs.

Those runs correspond almost perfectly with Kubernetes
deployment failures.

Removing the reference causes those cases to regress.

Conclusion:

Progressive disclosure is functioning correctly.
Keep the reference separate.
```

---

# 100. Example script conclusion

```text
The agent spends an average of four LLM turns extracting
timestamps and matching log lines.

This operation appears in 82% of runs.

A deterministic parser achieves identical eval performance
with 92% lower latency for this phase.

Conclusion:

Replace the reasoning sequence with a script.
```

---

# 101. Developer CLI

Eventually provide utilities such as:

```text
agentobs doctor

agentobs inspect

agentobs run show <id>

agentobs architecture

agentobs eval

agentobs compare

agentobs analyze

agentobs experiment
```

### Why

The system should be usable without living exclusively in dashboards.

---

# 102. `agentobs doctor`

Should verify:

```text
Copilot configuration

VS Code telemetry

OTel Collector

Azure credentials

Application Insights

Log Analytics

Grafana

hooks

agent directories

skill directories

Vally

optional SkillOpt
```

---

# 103. `agentobs inspect`

Static/dynamic summary:

```text
Agents:        7
Skills:       18
References:   42
Scripts:      13

Static edges: 89
Observed:     58

Unused components: 11
```

---

# 104. `agentobs run show`

Human-readable execution:

```text
Run       XYZ
Result    failed
Agent     pipeline-debugger
Version   24
Tokens    31,203
Duration  72.1s

00.0  agent start
01.2  skill diagnose
02.1  reference evidence.md
03.4  get-build
04.3  get-timeline
09.1  get-logs
14.7  get-logs
21.1  get-logs
28.4  context compact
29.1  regression-agent
...
```

---

# 105. Repository structure

Potential shape:

```text
.agentobs/
  config.yaml

agentobs/
  telemetry/
  analysis/
  architecture/
  optimizer/
  correlation/
  cli/

observability/
  collector/
  dashboards/
  kql/

infra/
  *.bicep

evals/
  regression/
  routing/
  architecture/
  holdout/

experiments/
  accepted/
  rejected/

reports/
  architecture/
```

---

# 106. Implementation sequence

Do not jump directly to the optimizer.

## Phase 1

Research the ecosystem.

## Phase 2

Verify native Copilot/VS Code telemetry.

## Phase 3

Build local trace collection.

## Phase 4

Ship sanitized telemetry to Azure.

## Phase 5

Add workflow correlation/versioning.

## Phase 6

Instrument scripts.

## Phase 7

Track references.

## Phase 8

Build dashboards/KQL.

## Phase 9

Build static architecture graph.

## Phase 10

Build dynamic architecture graph.

## Phase 11

Create eval baseline.

## Phase 12

Build deterministic architecture analytics.

## Phase 13

Build read-only architecture reviewer.

## Phase 14

Generate candidate changes.

## Phase 15

Automatically evaluate candidates.

## Phase 16

Generate PRs.

## Phase 17

Integrate SkillOpt.

### Why

An optimizer without high-quality telemetry and evals only automates guesswork.

---

# 107. Research deliverables

Before implementation, research should produce:

```text
Executive summary

Current ecosystem map

Native-vs-custom capability matrix

Compatibility matrix by runtime

Detailed logical architecture

Detailed deployment architecture

Full end-to-end dataflow

Telemetry schema

Security/data classification

Trace-propagation findings

Reference-tracking design

Script-instrumentation design

Local-development architecture

Azure architecture

Evaluation architecture

Architecture optimization design

Public benchmark-agent list

Gap analysis

Unknowns

Experiments required

Implementation sequence

Source catalogue
```

---

# 108. Every important technical claim needs evidence

Research should link directly to:

```text
official documentation

specific repository files

source code

schemas

examples

release notes

issues only where necessary
```

It should record:

```text
source
what it proves
confidence
date checked
```

---

# 109. Unknowns should remain explicit

Do not hide unresolved behavior.

Use:

```text
CONFIRMED

EXPERIMENTAL

UNVERIFIED

CUSTOM REQUIRED

UNSUPPORTED
```

Example:

```text
UNVERIFIED

Whether Copilot CLI propagates W3C trace context
into arbitrary runCommand child processes.

Required experiment:
launch instrumented Python child and compare trace IDs.
```

### Why

An explicit unknown is better than a false architectural assumption.

---

# 110. Ultimate definition of success

For any run, an engineer should be able to answer within minutes:

1. What agent handled this?
2. How was it invoked?
3. What subagents ran?
4. Why/when were they invoked?
5. What skills loaded?
6. Which references were read?
7. What tools ran?
8. In what exact order?
9. How long did each operation take?
10. What failed?
11. What retried?
12. What scripts ran?
13. Where was time spent inside those scripts?
14. Which model calls occurred?
15. How many tokens were used?
16. Was context compacted?
17. Was anything truncated?
18. Where did the run first diverge from a successful pattern?
19. Is this failure common?
20. Which architecture component correlates with it?
21. Can we convert it into an eval?
22. What change could address it?
23. Can that change be tested independently?
24. Did that candidate improve actual task performance?
25. Did it introduce any regression?

---

# 111. Ultimate architecture goal

The system should transform agent development from:

> “The agent seems messy, maybe I'll split this skill.”

into:

> “Telemetry shows this skill boundary introduces a routing decision in 93% of runs, contributes 14% additional tokens, almost never executes independently, and fails more frequently after context compaction. A merge candidate improved the held-out suite without introducing critical regressions.”

That is the fundamental objective.

---

# 112. One-sentence product definition

> **Build a Microsoft/Azure-native flight recorder and profiler for Copilot agent systems that observes agents, subagents, skills, references, tools and scripts end-to-end, converts real execution data into evals and architecture insights, and safely experiments with evidence-backed improvements to the agent system itself.**

---

# 113. Core principles

Keep these principles throughout the project:

**Observe before changing.**

**Use native telemetry before inventing custom telemetry.**

**Trace the entire workflow, not merely LLM calls.**

**Preserve execution order.**

**Keep metadata broadly available and rich content narrowly controlled.**

**Treat skills and references as measurable architectural components.**

**Use deterministic statistics before asking an LLM for conclusions.**

**Treat architectural recommendations as hypotheses.**

**Change one major variable at a time.**

**Protect held-out evals.**

**Correctness comes before cost or simplicity.**

**Keep rejected experiments.**

**Make every architecture change reproducible.**

**Progressive disclosure is useful; progressive indirection is not automatically useful.**

**The objective is not fewer components. The objective is the simplest architecture that reliably performs the job.**