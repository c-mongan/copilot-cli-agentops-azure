# AgentOps usability study kit

Status: study protocol only. No participant results are included. Passing automated tests does not prove human usability.

## What this study answers

Can a new user:

1. set up AgentOps without changing plain `copilot` by accident;
2. run one observed Copilot task and find its receipt;
3. use Today, Runs, Run Story, and Privacy without knowing Grafana or KQL;
4. explain what AgentOps records and what it does not record?

Use 5–10 participants for a pilot. Include developers, platform operators, and at least one keyboard-only user. A screen-reader study is a separate required accessibility activity; do not infer it from this study.

## Safety and preparation

- Use a non-production test project and the approved development subscription.
- Use synthetic files and a harmless prompt. Do not use customer data, secrets, source code, or personal data.
- Keep content capture off and privacy mode strict.
- Tell the participant what will be recorded before starting.
- Record task timings, task outcomes, help requests, error categories, and questionnaire answers only. Do not record prompts, terminal output, code, tool arguments, tool results, screen video, voice, names, or email addresses in the evidence JSON.
- Use a random participant reference such as `participant-a1b2c3d4`. Keep any consent record outside this repository.
- Check that `agentops init --full` targets the intended development subscription before allowing apply.

Required setup:

- AgentOps package ready to install through the supported route.
- GitHub Copilot CLI installed and signed in.
- Azure CLI signed in to the approved development subscription when Azure setup is part of the session.
- A synthetic repository containing one harmless task, for example creating `agentops-study-note.txt` with the text `study complete`.
- Today, Runs, Run Story, and Privacy links available from the test deployment.
- A stopwatch or timestamp capture tool.

## Facilitator opening script

Read this without adding product instructions:

> We are testing AgentOps, not you. Please work as you normally would and say what you expect before each action. I will record timings, whether each task worked, help requests, and broad error categories. I will not record your prompt, code, terminal output, tool inputs or results. You may stop at any time. Please do not use real secrets or customer data.

Ask for consent to continue. Record only `consent_confirmed: true`; do not put consent documents or identity data in the study evidence.

## Tasks

Start the timer when the facilitator finishes reading a task. Stop it when the success condition is met or the time limit is reached. Do not help unless the participant asks or safety requires it. Record each help request.

### Task 1: Preview setup

Say:

> Set up AgentOps, but preview all changes before applying them. Tell me whether plain `copilot` will change.

Expected starting point: the README or installed command help.

Canonical command:

```text
agentops init --full
```

Success criteria, within 5 minutes:

- reaches the preview without applying changes;
- identifies the expected and active Azure subscription;
- correctly says that plain `copilot` remains unchanged unless transparent routing is explicitly enabled;
- can name the next command that would apply the setup.

Critical failure: applies setup to an unexpected subscription or enables transparent routing unintentionally.

### Task 2: Apply setup

Say:

> Apply the reviewed setup and tell me whether it completed safely.

Canonical command:

```text
agentops init --full --yes
```

Success criteria, within 7 minutes:

- applies only after reviewing the target;
- recognizes success or gives the exact recovery action shown by the product;
- does not expose a token, connection string, prompt, or source content.

Critical failure: continues after a subscription mismatch or reports success when setup failed.

### Task 3: Run an observed Copilot task

Say:

> Ask Copilot to complete the harmless study task with AgentOps observing it. Then show me the receipt.

Canonical command shape:

```text
agentops copilot -p "<synthetic study prompt>"
```

Success criteria, within 5 minutes:

- chooses `agentops copilot`, not plain `copilot`, for an observed run;
- finds the receipt;
- can identify status, elapsed time, token information when available, privacy mode, and the Run Story action;
- does not mistake an unavailable field for zero.

### Task 4: Answer “what happened today?”

Say:

> Open Today and tell me whether the observed run succeeded, how long it took, and the most useful next action.

Success criteria, within 3 minutes:

- opens Today without needing Grafana or KQL knowledge;
- finds the correct run status and duration;
- describes one evidence-backed next action;
- does not present estimated cost or inferred outcomes as exact facts.

### Task 5: Find a run

Say:

> Use Runs to find the study run and open its story.

Success criteria, within 2 minutes:

- finds the correct run using time, status, agent, repository, or run identifier;
- opens the matching Run Story;
- does not open a different run without noticing.

### Task 6: Explain the Run Story

Say:

> Tell me, in order, what the agent did. Point out any custom agent, subagent, skill, model, MCP server, tool, script, or CLI activity that is present. Then tell me what is unknown.

Success criteria, within 5 minutes:

- follows the event order correctly;
- distinguishes observed items from absent or unavailable items;
- finds timing, token, status, and parent/child information when present;
- does not claim that an activity occurred merely because the UI supports that activity type.

### Task 7: Check privacy

Say:

> Use Privacy to decide whether AgentOps recorded the prompt, code, file contents, tool arguments, or tool results for this run.

Success criteria, within 3 minutes:

- opens Privacy for the correct run;
- correctly reports strict mode and content capture off;
- understands that AgentOps metadata-only proof does not make claims about data stored independently by GitHub Copilot or another tool;
- can identify a privacy drop or schema warning if the study fixture includes one.

Critical failure: believes strict mode proves that every connected product stores no content.

## Timing and error capture

For every task record:

- start and end timestamps in UTC;
- elapsed milliseconds;
- outcome: `success`, `partial`, `failed`, or `not_attempted`;
- number of help requests;
- whether the participant recovered without help;
- zero or more error categories from the evidence schema;
- the product surface used.

Do not write a transcript. If context is needed, choose a fixed observation code. Product defects belong in the normal issue tracker, linked by an opaque issue reference.

Study-level pilot targets:

- at least 80% unassisted success for Tasks 1, 3, 5, and 7;
- median observed-run-to-receipt time under 5 minutes;
- median Runs-to-correct-Run-Story time under 2 minutes;
- zero critical safety or privacy-comprehension failures;
- at least 80% correct answers to every privacy comprehension question.

These are proposed pilot thresholds, not current results.

## Privacy comprehension questions

Ask after Task 7. Do not coach until all answers are recorded.

1. Does AgentOps record prompts by default? Expected: no.
2. Does AgentOps record code or file contents by default? Expected: no.
3. Does AgentOps record tool arguments or tool results by default? Expected: no.
4. What can AgentOps record in strict mode? Expected: metadata such as event type, safe names, order, timing, status, tokens, privacy decisions, and derived outcomes.
5. Does this screen prove that GitHub Copilot itself stored no content? Expected: no; the statement is scoped to AgentOps.
6. What should you do if Privacy shows a dropped or unknown field? Expected: inspect the warning and follow the safe review or support action before broader rollout.

Record `correct`, `incorrect`, or `not_answered`; do not store the participant's verbatim answer.

## Optional SUS-style questionnaire

This is a ten-item usability pulse using the standard 1–5 agreement pattern. It is optional and must be labelled “SUS-style” unless the study uses the licensed/approved standard wording and scoring process required by the organization.

Scale: 1 strongly disagree, 2 disagree, 3 neutral, 4 agree, 5 strongly agree.

1. I would like to use AgentOps frequently.
2. AgentOps felt unnecessarily complex.
3. AgentOps was easy to use.
4. I would need help from a technical expert to use AgentOps.
5. The main parts of AgentOps worked well together.
6. AgentOps felt inconsistent.
7. Most intended users would learn AgentOps quickly.
8. AgentOps felt awkward to use.
9. I felt confident using AgentOps.
10. I needed to learn a lot before I could use AgentOps.

If a SUS-style score is calculated, use the usual alternating contribution: odd items contribute `answer - 1`; even items contribute `5 - answer`; multiply the sum by 2.5. Report response count and missing items with the score. Do not compare a very small pilot as if it were a representative benchmark.

## Closing questions

Ask, but store only fixed categories and optional issue references:

- Where did you first feel unsure?
- Which screen gave you the most useful answer?
- What did you expect to find but could not?
- Was any privacy statement unclear or too broad?
- What is the one change that would save you the most time?

## Evidence and reporting

Store one JSON file per completed participant session using [the study evidence schema](usability-study-evidence.schema.json). Validate it before aggregation.

Always report these separately:

- protocol prepared;
- automated schema/contract validation;
- number of real consenting participants;
- participant environment and assistive technology coverage;
- per-task outcomes and timing;
- privacy comprehension;
- optional SUS-style responses;
- unresolved critical failures.

Never turn a schema test, facilitator dry run, synthetic browser test, or researcher walkthrough into a claim of human usability.
