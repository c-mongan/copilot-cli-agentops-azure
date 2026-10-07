# AgentOps context

AgentOps observes agent workflows and compares their observed behavior with the architecture they declare, so teams can investigate runs and evaluate changes.

## Language

**Run**:
One user task and the agent activity undertaken to answer it, including delegated work and deterministic helpers.
_Avoid_: Session, trace, or turn when referring to the entire task.

**Declared component**:
An agent, skill, reference, script, or tool defined as part of a workflow, whether or not it appears in a particular run.
_Avoid_: Active component.

**Observation**:
Evidence that a specific activity occurred during a run, with its source and time or causal position.
_Avoid_: Proof of an unobserved activity.

**Coverage**:
The stated boundary of what a source could observe in a run, including gaps and unsupported activities.
_Avoid_: Completeness when only some sources are available.

**Skill activation**:
The point at which an agent loads a skill's instructions for use in a run.
_Avoid_: Skill discovery, which exposes only identifying metadata.

**Reference use**:
An observed read or load of material referenced by a skill during a run.
_Avoid_: Declared reference, which may never be read.

**Script execution**:
One invocation of deterministic code by an agent workflow, including its outcome and any observed internal activity.
_Avoid_: Tool call when the script's own behavior is being discussed.

**Correlation**:
A supported link between observations from different sources that belong to the same run or operation.
_Avoid_: Parent-child trace relationship unless trace context proves it.

**Candidate change**:
One bounded alteration to the declared workflow that is tested against a baseline before adoption.
_Avoid_: Recommendation as if it were an established improvement.
