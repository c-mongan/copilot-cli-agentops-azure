# Opt in to observing a Copilot process

Status: accepted for the Copilot CLI-first pilot.

AgentOps observes a deliberately started Copilot CLI process by enabling native OTel for that process and loading any passive observer plugin through `--plugin-dir`. Repository architecture discovery covers all declared agents and skills, while telemetry collection covers only opted-in processes. Setup does not commit repository hooks, permanently install a hook-bearing plugin, persist shell exports, or enable enterprise-wide collection. This avoids running AgentOps hooks or exporting content when another contributor uses an unrelated agent in the same repository. It means a plain process started without telemetry cannot be reconstructed later, and selecting `/agent` mid-process does not undo content already captured in earlier turns. Team-wide collection requires a separate explicit deployment decision.
