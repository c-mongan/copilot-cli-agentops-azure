# Native automatic onboarding verification

Verified on 2026-10-03. The implementation is a local pilot. This work did not publish an extension, change the normal VS Code profile, send telemetry to Azure, or invoke a model. Existing user changes remain in the working tree.

```text
One Connect in VS Code
       |
       +-- Copilot Chat: native HTTP JSON settings
       +-- New integrated terminals: native Copilot CLI environment
                       |
             strict local Collector
                       |
              private receipt
                       |
              local count report
```

## Qualification correction from deeper source review — 2026-10-03

The earlier API and fixture checks remain valid. They did not establish native Chat capture. Deeper installed-source inspection found a restart ordering defect: Chat needs reload to use changed export settings, while AgentOps restores those settings and stops its Collector at host shutdown, then allocates a new endpoint. The earlier statement that no P1/P2 source finding was open describes the earlier review only; this new material lifecycle finding is now open. Chat automatic capture is unqualified until this is corrected and tested. New CLI terminal environment inheritance remains verified; actual CLI-generated spans remain unverified. See [source evidence](2026-10-03-vscode-native-deep.md) and the [CLI-first completion contract](2026-10-03-cli-first-native-architecture.md).

## Delivered behavior

The extension uses VS Code's Node runtime. Users do not need an AgentOps CLI, Node, npm, Docker, or Azure CLI installation. Copilot CLI itself must be installed to use Copilot CLI. Connect obtains the pinned official Collector in private extension storage and verifies its checksum. Capture starts only after consent, or at the next trusted local start after prior consent.

One window owns capture per profile. Privacy settings are set before routing and capture are enabled. Disconnect restores only settings that still have the extension's values. A private restore record supports recovery. An IPC worker stops its Collector when its owner exits. Receipts remain local. Reports read a bounded snapshot and contain fixed labels and numbers. Missing token counts, task outcome, and coverage remain unknown. Root token aggregates and duplicate spans do not inflate LLM totals.

## Proof

| Check | Verified result |
| --- | --- |
| Final focused settings, runtime, parser and package tests | 34 passed; 0 failed; 0 skipped |
| Full CLI suite after the shared parser change | Exit 0; 90.50% line coverage |
| Real VS Code API | Six Chat settings effective; durable snapshot and conditional restore passed |
| Official first-connect download | Pinned 0.151.0 archive downloaded; official SHA256 matched; real tar extraction and start/stop passed |
| Real local Collector | JSON and protobuf accepted; strict test canary absent; receipt mode 0600 |
| Real process cleanup | Explicit stop and forced owner crash stopped the Collector and closed its listener |
| Packaged runtime | Loads after disposable source removal; no package dependencies or CLI entry point required |
| Isolated VSIX installation | VS Code CLI reported successful installation |
| Real terminal inheritance | Actual extension context applied all eight native variables to a new nonlogin integrated terminal; none were present in a new terminal after Disconnect |
| Real Electron extension host | Packaged controller, IPC worker, real Collector, effective Chat settings, synthetic receipt and disconnect passed |
| Installed extension activation | Isolated extension-host log records agentops-local.agentops-native startup activation |
| Static repository check | 1045 files checked; no failures |
| Independent review | Accepted local pilot; no open P1/P2 source finding |
| Graphify local refresh | 5482 nodes and 13253 edges; no remote or semantic extraction |

See the [real Collector proof](2026-10-03-native-collector-proof.md), [real API proof](2026-10-03-native-vscode-api-proof.md), [settings contract](../native-client-settings.md), and [implementation plan](../plans/2026-10-03-native-automatic-onboarding.md).

## Limits

The installed Insider release rejects two required Agent Host settings as unregistered. The extension skips all Agent Host changes and reports that path as unavailable. This does not block Chat or new integrated CLI terminals. A source registry entry does not prove extension API support.

The terminal environment applies to new integrated terminals in the owning VS Code window. Existing and external terminals do not receive the extension environment. Existing terminals must close and reopen. External device capture requires a separate enterprise managed policy deployment. The generic OTEL environment can also affect other instrumented programs in new integrated terminals; consent states this scope.

The first integrated extension-host check used consent and terminal environment fixtures. A later qualified2 check used the real extension context, memento, storage, and environment collection. New terminals inherited all eight variables without explicit terminal env options; terminals created after Disconnect received none. Consent was a fixture and no live Copilot session ran. Webview creation was verified through the API; its rendered controls were not observed. Actual Copilot-generated spans were not requested in this qualification. Synthetic native-shaped spans prove transport, filtering, parsing, and cleanup. They do not prove complete capture, task success, diagnostic benefit, or model quality. The strict filter removes disallowed content and identity fields. It preserves allowed metadata such as service.name. It is not an arbitrary secret detector for values placed in allowed fields. The report shows only fixed labels and numbers. Managed policy behavior is not qualified: the real VS Code inspect result did not expose policyValue. Effective values are checked after writes and failed updates restore owned values.

Rendered VS Code controls remain unverified. The UI tool selected the normal VS Code instance and could not select the isolated test process; screenshot capture was unavailable. Only the Window menu was inspected in the normal instance. The isolated process was closed without a Connect action. API, fixture lifecycle, package installation, and activation proof remain separate from rendered UI proof.

## Artifact

The final tested package is:

`/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-native-vsix-20261003-qualified2/agentops-local.agentops-native-0.1.0.vsix`

Install through VS Code's Extensions menu, **Install from VSIX**. Then select **AgentOps: Connect native capture** in a trusted local workspace. A client reload can be necessary.

Package SHA256: `f4d43161acb4425e03601d55f41d7cb119dd92be424a4eb04f18d02ea561c889`. All four packaged extension source files match the final source files byte for byte.

A real ExtensionContext test found that local storage uses vscode-userdata. The previous file-only check blocked Connect. The guard now accepts local file or vscode-userdata storage with an absolute path, a trusted workspace, and no remote connection. Independent readback and six lifecycle checks passed.
