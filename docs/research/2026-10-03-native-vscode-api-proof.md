# Native VS Code API proof — 2026-10-03

The settings adapter passed a real VS Code extension-host test. The test used VS Code Insiders `1.141.0-insider` and the installed GitHub Copilot package `0.69.2026100103`. It changed only a disposable external profile. It made no model request and no cloud write.

The test harness used `--extensionTestsPath` and two `--extensionDevelopmentPath` arguments: the local test harness and the existing bundled Copilot package. Copilot was absent from the initial extension-test inventory. Loading its existing package as a development extension made its configuration contributions available. This is real API proof with that package loaded. It is not proof that a normal profile emits live Copilot spans.

```text
Disposable VS Code profile
  -> real configuration API
  -> Chat settings adapter
  -> six effective native settings
  -> conditional restoration
```

The following checks passed:

1. All six Chat settings had API defaults. The adapter made capture content and identity `false`, the exporter `otlp-http`, the protocol `http/json`, the endpoint a literal loopback address, and enabled capture. The snapshot contained six entries and was saved before the writes.
2. Disconnect restored prior user values and removed owned entries. A later user change to the protocol remained in place.
3. The API rejected a Workspace write to the Chat enabled setting. These Chat settings have `application` scope and can be changed through User settings. The test did not insert an unsupported workspace override through a raw file.
4. A conflicting `OTEL_EXPORTER_OTLP_ENDPOINT` blocked connection before a settings snapshot or write.
5. Incomplete Agent Host support did not block Chat. The adapter wrote no Agent Host setting and reported that family as unsupported.

Two findings changed the adapter before the final pass:

- `Configuration.inspect()` returns an object for an unknown setting. A non-null result does not prove registration. Its default and effective values were `undefined`, and a write failed as an unregistered configuration. The adapter now checks for an explicit API default.
- The workbench source contains hidden Agent Host entries for `chat.agentHost.otel.otlpProtocol` and `chat.agentHost.otel.captureIdentity`. On this installed build, both have no API default and both reject an API update as an unregistered configuration. The four visible Agent Host settings alone are insufficient for the required privacy and protocol contract. The adapter skips the whole optional family.

No `policyValue` property was present in any real `inspect()` result. There was no enterprise policy in this disposable profile. The test does not prove detection of a managed policy before a write. The adapter checks effective values after writes and restores its owned settings if they do not take effect.

The receipt is `/Volumes/SanDisk Archive/Agent-Workspace/scratch/agentops-native-20261003/api/proof.json`, with `passed: true`. The direct hidden-key rejection receipt is `hidden-agenthost-proof.json` in the same directory. The harness and isolated profile remain there for repeat tests. The normal VS Code profile and its settings were not changed.

Live native Copilot span delivery, a managed enterprise profile, remote extension hosts, and other operating systems were not tested by this API check.

## Packaged runtime in a real extension host

A second check used the extension files extracted from the qualified VSIX at `/Volumes/SanDisk Archive/Agent-Workspace/artifacts/agentops-native-vsix-20261003-qualified2/content/extension`. The real VS Code extension host loaded `createController` and the packaged recorder. The recorder forked its IPC worker from the Electron host and started the existing local OpenTelemetry Collector binary. The test supplied that binary path through a test dependency; it did not test a release download.

The consent result was a test fixture that returned `Connect`. The terminal environment collection and extension memento were test maps. VS Code configuration calls, the status bar, webview creation, the worker process, Collector process, local HTTP endpoint, private disk receipt, and report parser were real. No normal profile, model request, or cloud endpoint was used.

The following checks passed:

1. Connect started the real strict Collector through its packaged worker. The real Chat settings used its selected loopback endpoint. The test environment map received eight native variables.
2. The Collector accepted one synthetic native OTLP JSON span. The packaged report read one session and one span, with `12` input tokens and unknown output tokens. Coverage and task outcome remained unknown.
3. Content and identity poison in `gen_ai.prompt`, `user.name`, and the span name did not appear in the receipt or report HTML. The initial test also put poison in `service.name`; that value remained because service name is permitted metadata in the existing filter contract. The final contract test used a fixed fixture service name. Strict filtering is not a secret detector for arbitrary values placed in permitted metadata fields.
4. Status reported the received span. A real static webview panel was created. This check proves panel creation, not a screenshot or rendered interaction.
5. Disconnect restored every real Chat user setting, cleared the fixture environment map, and closed the Collector HTTP listener. The controller then disposed without error.

The integrated receipt is `/Volumes/SanDisk Archive/Agent-Workspace/scratch/agentops-native-20261003/api/integrated-proof.json`, with `passed: true`. Its test harness is `harness/integrated-runner.js`. This is an integrated native-shaped fixture proof in a real extension host. It does not prove that a live Copilot session emitted those spans. The separate terminal check below proves real terminal inheritance.

## Real extension context and terminal check

The terminal check used the real activation context of the disposable harness extension. Its storage URI had scheme `vscode-userdata`, with a local filesystem path in the disposable profile. The workspace was trusted and had no remote authority. The first run exposed a runtime defect: the controller accepted only storage scheme `file`, so it blocked this real local context before any settings or terminal write. The earlier context fixture used scheme `file` and did not expose that defect. The failure receipt is `terminal-local-scheme-failure.json`; the real context receipt is `terminal-context.json` in the API scratch directory. The runtime owner was notified for repair and repeat verification.


The runtime owner repaired the local storage check. The final `qualified2` VSIX passed the repeated check with the real activation context. The controller used the real environment collection, real extension memento, and real storage URI. Only consent and selection of the existing Collector binary remained test fixtures.

A new integrated terminal used `/bin/sh` in non-login mode to run a local Node fixture. The terminal call supplied no `env` option. The fixture wrote only the eight controlled native telemetry keys to a private external file. All eight values matched the controller endpoint and required privacy/protocol values. After Disconnect cleared the real environment collection, a second new terminal contained none of the eight variables. This proves automatic environment injection and removal for new integrated terminals on this installed VS Code build. It does not prove existing or external terminal coverage.

The final real-context receipt is `terminal-proof.json`, with `passed: true`; its harness is `harness/terminal-runner.js`. The earlier local-scheme failure remains in `terminal-local-scheme-failure.json`. The final packaged runtime span/receipt/disconnect test was also repeated against `qualified2` and passed. Neither terminal invoked Copilot or requested a model. No UI screenshot or rendered interaction is claimed by these extension-host tests.
