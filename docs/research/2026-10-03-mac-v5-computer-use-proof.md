# Mac v5 computer-use proof

Date: 2026-10-03. Target: the existing unsigned Mac v5 companion preview. This test used native computer control and Chrome to operate the rendered app controls. It did not install or deploy cloud services.

## Acceptance results

| Check | Result | Evidence |
| --- | --- | --- |
| Connect | Passed | Visible Collector-ready state on port 4318. |
| Start Copilot in Terminal | Button acknowledgement observed | The app reported that it opened the terminal. Interactive Terminal use is not proved. |
| Native CLI capture | Passed, separate local runtime test | Real installed Copilot CLI, synthetic local model, four spans in one trace, agent parent links, fixed tool execution. |
| Privacy filter | Passed for the fixture | The canary was observed before filtering and absent from the retained receipt. |
| Rendered report | Passed | Five received native spans, two sessions, 24 input tokens and 10 output tokens. Coverage and outcome remained unknown. |
| Disconnect | Passed | Visible disconnected state and port 4318 closed. |
| Quit | Passed | Visible stopped state, owner PID 30058 gone, capture lease removed, ports 4318 and 58235 closed. |

The report total and the fixture's four spans measure different things. The Collector already had receipt bytes before the fixture began. The fixture qualifier checked only newly appended data. Do not treat all five report spans as fixture spans or infer the source of the extra span.

## Saved evidence

Evidence root: `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/native-build-20261003/`.

- `companion-v5-native-proof.json`: native runtime, links, fixed tool execution and canary checks. Its `collectorStopped: false` describes the runtime-test stage; the later UI proof confirms shutdown.
- `companion-v5-ui-proof.json`: report totals and process/listener/lease cleanup.
- `companion-v5-report.png`: rendered report screenshot.
- `companion-v5-quit.png`: stopped-state screenshot.

The private receipt remains in the companion's internal Application Support directory. Do not publish raw receipts. No paid model, new Azure write or new cloud resource was used for this trial.

## Open gates and tool limits

The computer-use tool explicitly denied access to `com.apple.Terminal`. No alternate desktop-control method was used to bypass this restriction. The real CLI fixture was an independent backend test. It does not prove interactive input in the opened Terminal window. The app and Collector were stopped; cleanup of the opened Terminal window was not verified.

VS Code native inspection worked. Its command-palette shortcut and visible View > Command Palette action did not open the palette. The editor remained visible. No temporary profile, VSIX installation, script-wizard flow or Microsoft sign-in was completed through this UI. Existing user windows and settings were preserved.

Windows headless qualification remains separate from a normal Windows desktop trial. This Mac trial also does not prove live VS Code Chat after reload, a real model's diagnostic quality, human usefulness or full native/library trace delivery to Azure.
