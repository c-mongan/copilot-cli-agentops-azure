# Local diagnostic pilot

Use the recorder to capture a run, then build the local diagnostic product from
its actual ledger. Node.js 20 or newer and an authenticated Copilot CLI are the
local prerequisites. Azure, Aspire, Docker, and Grafana are optional.

```text
Attach inventory → explicit recorded run → local ledger → Runs / Architecture / Compare
                                                   → qualified evidence preview
                                                   → separately approved cloud delivery
```

1. Inspect runtime support and attach your repository.

   ```bash
   agentops product runtime --json
   agentops attach --repo /path/to/repo --yes --json
   ```

   Runtime qualification reads version metadata. Missing packages and different
   versions are explicit; this check does not install or execute a model.
   Attach writes only the project-owned inventory. It does not install hooks.

2. Start an explicit local recorder session.

   ```bash
   agentops copilot-session launch --repo /path/to/repo --json -- -p "Your bounded task"
   ```

   This invokes Copilot and therefore uses your configured model entitlement.
   Review the launch arguments before running it. The recorder returns the actual
   run directory and session identity. It does not upload unless the separate
   upload option is explicitly selected. Metadata-only output is the default.

3. Build the local product from the recorded ledger, using a new output directory.

   ```bash
   agentops product build --repo /path/to/repo --ledger "$HOME/.agentops/runs" --out /path/to/new-report --json
   ```

   Open `/path/to/new-report/index.html`. Runs shows observed execution;
   Architecture shows inventory and diagnostic hypotheses; Compare shows stored
   experiments when supplied with `--experiments /path/to/experiments`.
   Existing output directories are preserved. The product receipt links the
   generated views and local evidence bundle. A generated file is local proof;
   cloud delivery remains pending until an independently verified upload and
   cloud readback exist.

4. Preview outcome evidence or assess protected trial receipts.

   ```bash
   agentops product evidence --ledger "$HOME/.agentops/runs" --repo /path/to/repo --json
   agentops product evidence --ledger "$HOME/.agentops/runs" --repo /path/to/repo --evaluation /path/to/evaluation.json --out /path/to/new-evidence --json
   agentops product compare --experiment /path/to/experiment.json --baseline-root /path/to/baseline --candidate-root /path/to/candidate --json
   ```

   Evidence previews by default; `--out` writes owner-only files. Evaluation
   assertions alone do not establish a successful outcome. Qualified receipts
   must match the recorded run and pass the deterministic verifier. Supply
   `--evaluation-key /path/to/protected-key.json`,
   `--evaluation-records /path/to/source-records.json`, and
   `--evaluation-workspace /path/to/approved-synthetic-workspace` together to
   replay the held-out grader. The protected key stays outside the repository
   with owner-only permissions. Replay verifies actual artifacts against that
   key; reported model/runtime provenance still needs independent execution proof. Missing
   provenance stays unknown. Compare validates a predeclared single treatment,
   matching identities, protected trials, and recorded sink references. It does
   not execute trials, authorize changes, merge code, or claim causality.

Use `agentops product audit --json` for the existing product audit. Live audit
and browser qualification remain explicit options. For native monitoring, see
[the Azure-native design](simplified-azure-design.md) and
[the junior quickstart](junior-quickstart.md). Cloud spending, target approval,
privacy, and readback gates remain separate from this local pilot.
