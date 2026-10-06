# Native recorder: real Collector proof

Verified on 2026-10-03 on macOS arm64. This proof used disposable external storage. It did not use a cloud service, a model request, or a private user session.

The extension `startRecorder` ran its real owner IPC worker and the existing `~/.agentops/collector/bin/otelcol-contrib` binary. The binary reported version `0.151.0`. The test supplied this binary with the supported `ensureCollector` test dependency. A separate first-connect download check is recorded below.

```text
Synthetic OTLP JSON + protobuf
             |
             v
Extension owner -> IPC worker -> strict local Collector
                                      |
                                      v
                              Private receipt -> report
```

## Results

| Check | Result |
| --- | --- |
| OTLP HTTP JSON request | HTTP 200 |
| OTLP HTTP protobuf request | HTTP 200 |
| Strict filtering | Synthetic secret canary absent from receipt, report, and both Collector run directories |
| Receipt permissions | `0600` |
| Parsed distinct spans | 3, across 1 synthetic session |
| Token total | 17 input and 5 output tokens across 2 observed LLM spans |
| Duplicate and root aggregate | Duplicate LLM span counted once; root aggregate excluded from token total |
| Report uncertainty | Capture coverage and task outcome both `unknown` |
| Explicit stop | Collector process exited, OTLP listener closed, receipt retained |
| Owner crash | Disposable owner received `SIGKILL`; worker stopped Collector, OTLP listener closed, receipt retained |
| Focused tests | 28 passed; 0 failed; 0 skipped |

The JSON request included an `invoke_agent` root, a `chat` child, and a duplicate of that child. The protobuf request included another `chat` span. The root carried the same input token total as its child. The report correctly excluded that root from the LLM total. The test placed a synthetic secret in the span name, message content attribute, arbitrary attribute, event name, event attribute, and user resource attribute.

The owner crash test killed only a disposable Node parent. It kept the worker alive long enough to observe IPC loss and stop its Collector. The proof does not cover killing the worker and Collector simultaneously, system power loss, or every operating system.

## Evidence

The runnable test and its machine-readable result are in:

- `<agent-workspace>/scratch/agentops-native-real-20261003/proof.js`
- `<agent-workspace>/scratch/agentops-native-real-20261003/evidence.json`

The explicit-stop receipt is retained in the `normal/receipts` directory. The crash-test receipt is retained in the `crash/receipts` directory. The result records their exact paths, the test endpoint, and Collector process IDs.

The focused regression command was:

```sh
node --test extensions/agentops-native/test/recorder.test.js agentops-cli/test/copilot-session-otel.test.js agentops-cli/test/copilot-session-span-export.test.js
```

## Limits

These were native-shaped synthetic spans sent to a real Collector. They prove the local transport, filtering, parser, report totals, and tested cleanup paths. They do not prove that an actual Copilot CLI or VS Code model session emitted telemetry. They do not prove cloud delivery, complete capture, task success, model quality, or diagnostic value for a human operator. VS Code settings, UI, and package installation need separate proof.

## First-connect release download

The real `ensureCollector` function downloaded the pinned official `0.151.0` release into a new disposable external directory. The check used the actual release helper for HTTPS download and SHA256 verification. Small wrappers recorded results; they did not replace the network, hash, or extraction operations. The actual system `tar` extracted only the known Collector binary.

| Check | Result |
| --- | --- |
| Platform | `darwin/arm64` |
| Official release archive | `otelcol-contrib_0.151.0_darwin_arm64.tar.gz` |
| Archive bytes | 92,734,129 |
| Official checksum file bytes | 5,176 |
| SHA256 expected and actual | `ee90da0191ec644d72c407a2b25d7451892d03fdd3fb67aa020b19f32a599bc4` |
| Download, checksum, and extraction | Passed, 6.119 seconds in this run |
| Extracted binary version | `otelcol-contrib version 0.151.0` |
| Extracted binary permissions | `0700` |
| Start with downloaded binary | Real IPC worker and strict Collector started |
| Stop | Collector process exited and local OTLP listener closed |

The executable remained inside extension-shaped disposable storage. No global CLI installation occurred. `startRecorder(storage)` used its normal cached-binary path after the verified download. This establishes the macOS arm64 first-connect download path. It does not qualify Windows or Linux extraction, release signing beyond the official checksum, or network failure recovery.

Additional evidence is retained in:

- `<agent-workspace>/scratch/agentops-native-real-20261003/download-proof.js`
- `<agent-workspace>/scratch/agentops-native-real-20261003/download-evidence.json`

The storage check before this job confirmed the external volume UUID and 332.46 GiB of free external storage. The download and extraction used that external storage.
