# Windows qualification review — 2026-10-03

Result: no unresolved P1 or P2 finding in the bounded reviewed snapshot. Actual Windows execution is still required.

## Coverage

OCR delegation selected four source entries from 175 workspace changes; all four were reviewed and zero selected entries were skipped. OCR excluded 171 entries. Five task-specific fixture/test files were reviewed manually. Total bounded review: nine files. The prior native build review covers the unchanged shared implementation; this follow-up does not claim whole-repository coverage.

The parent-provided isolated snapshot has 68 manifest entries. The reviewer read back every isolated file hash and found zero mismatches. The 62-file helper source closure includes Azure uploader/spool/outbox dependencies. Four public instrumentation assets are present in the isolated snapshot so the default script planner can load. The workflow and remaining snapshot control file complete the manifest. The `./recorder` companion dependency is supplied by package assembly; source mode uses its explicit extension fallback.

## Trust and safety checks

- Copilot version 1.0.91 has a fixed official npm tarball URL and SHA512 pin. Live official npm metadata matched both values.
- VS Code version 1.140.0 has a fixed official distribution URL and SHA256 pin. Live Microsoft update metadata matched version, URL and digest. The digest is 64 hexadecimal characters.
- Collector version 0.151.0 uses the existing official release checksum flow; version drift fails qualification.
- Archives are verified before extraction. Extraction runs the absolute Windows system tar executable with argument arrays. Copilot extraction selects only `package/copilot.exe`.
- Batch command paths require absolute Windows paths and reject command expansion characters. The portable launcher forwards arguments to the installed VS Code runtime. No execution-policy bypass or global profile edit is introduced.
- The child CLI uses an isolated Copilot home and a restricted environment. Provider, GitHub, exporter-header and Node injection variables are not inherited. Native model requests go to the synthetic loopback fixture with offline mode enabled. The Windows tool requests only a fixed PowerShell marker.
- The qualification starts a real packaged companion with a new disposable profile and no browser. Its strict Collector stays running while the native receipt is checked, then Quit must release the lease and remove the owner process. Cleanup makes a bounded Quit attempt and uses a bounded Windows process-tree kill fallback for a remaining launcher.
- Workflow dispatch has read-only repository permissions, pinned action commits and disabled persisted checkout credentials. Only a bounded qualification summary is uploaded for one day. Raw receipts, stdout, stderr, tokens and user account data are not uploaded.

## Proof boundaries

The result separates native capture, tool execution, console observation, desktop browser and Azure qualification. A native failure cannot become a pass merely because the Collector is healthy. Windows headless proof does not qualify desktop installation, browser interaction, normal user profiles, Azure sign-in or cloud delivery. The output summary states those limits.

The reviewed helper still uses the shared downloader, whose network waits are not individually timed. The workflow has a 15-minute job timeout. This is a qualification reliability limit, not an open safety blocker for the disposable runner.

## Verification

Seventeen focused local tests passed, including digest corruption, batch quoting, source closure, scope validation, portable package assembly and shutdown. Scoped whitespace checks passed. The reviewer did not run a Windows host, download large archives, execute a paid model, sign in, publish, push, dispatch CI or change external services.

## Reviewed file snapshot

- `scripts/qualify-native-windows.js` — reviewed; SHA256 `f98ea8ba89c1b5a282bc2dc322ff8f87352ed997602aca8a26845c362fdef2cf`.
- `scripts/test/qualify-native-windows.test.js` — reviewed; SHA256 `1dab86567151e00fb1560d0ccca60238d40cc4055970ee11bcadedefde923827`.
- `scripts/fixtures/native-windows-ci.yml` — reviewed; SHA256 `2045f2e024db657ee98b5c08fed066930e319e5d28cf8601937059d6d9ffe553`.
- `scripts/qualify-native-cli.js` — reviewed; SHA256 `ebd5934e7e6732868b0fed78b42049a4e8b73326002d8d3e2cdd933a70bce2ef`.
- `scripts/test/qualify-native-cli.test.js` — reviewed; SHA256 `054da0171ad5a0653421b3b698bf13775969894f4269d84973620e6eb5350bdc`.
- `companion/src/server.js` — reviewed; SHA256 `e915f5034b06fafbb5cbf6dc353c5d26b7aef6167da9bed740f6e21ac49cd64e`.
- `companion/test/server.test.js` — reviewed; SHA256 `30d383573197834f04104b1d39162c60232f99ab7aa1512c69fa75b5dab009ba`.
- `scripts/package-native-companion.js` — reviewed; SHA256 `8bbbb27c490ef34c866bcdf4da33b2e4d68e5115116e864d88f9abdd57a66e7f`.
- `scripts/test/package-native-companion.test.js` — reviewed; SHA256 `c079592227d2ec9564693431c14fe1548ae619f60def7d2fc283bed02f25a4f1`.

## First actual Windows run — failed

Independent readback: [run 37148214250](https://github.com/c-mongan/copilot-cli-agentops-azure/actions/runs/37148214250), exact head `cdbafa38f473f3f495ce576e5ef5dcd8d0d6ba26`. Runner: Microsoft Windows Server 2025, x64; setup Node `v20.20.2`; downloaded VS Code Node runtime `v24.21.0`.

The main native suite reported 65 tests: 58 passed, 3 failed, 3 cancelled and 1 skipped. The separate qualification suite reported 10 tests: 9 passed and 1 skipped. The workflow marked the fixture step successful because the second command succeeded; PowerShell did not propagate the first command's failure. Required repair: fail explicitly after either nonzero native command.

Concrete failed assertion: `recorder.test.js:23` expects `/fixture/storage/receipts`; Windows returns `\fixture\storage\receipts`. Use the platform path builder for the assertion.

Azure mocked publication and retry tests expected one acknowledgement but got zero. The cancellation test awaited a mock request that never started. Source inspection identifies a credible cause: shared publishing byte reservation unconditionally opens and fsyncs a directory, which Node does not support in this way on Windows. The spool turns the uploader exception into a network failure, so no mocked request occurs. The directory flush must use a platform-aware persistence contract while preserving file flush, locking and budget reservations. This cause is source-supported; the logged result does not include the swallowed exception text.

Large pinned downloads and Collector checksum verification completed. Native real-runtime qualification failed at `portable-launcher` before the CLI fixture ran. The log does not reveal the exact launcher error. Default Node argument escaping applied to a quoted `cmd.exe /s /c` command is a likely cause. The repair must qualify the actual batch launcher and use correct Windows command-line quoting; direct runtime invocation would skip that acceptance requirement.

The failed run does not qualify native CLI capture, tool execution, companion launch, cleanup, desktop use or Azure delivery. The parent owns repairs and any new dispatch. This reviewer made no rerun, commit, push or cancellation.


## First Windows failure repair — bounded source review

Result: no open P1 or P2 finding in the six reviewed repair files. This review permits a new qualification attempt; it does not prove Windows runtime success.

Baseline: `cdbafa38f473f3f495ce576e5ef5dcd8d0d6ba26`. The reviewer compared each existing file against that exact commit. The current workflow template was compared against the baseline published `.github/workflows/ci.yml`. The added delivery-limit test was read in full. Six repair files were reviewed; zero were skipped. Unchanged files reuse the prior review.

- The publishing budget still holds the shared directory claim. It writes and flushes the temporary file before rename. Windows skips only the unsupported parent-directory flush. Ceiling, retry reservation, policy binding and target binding are unchanged. Windows has a weaker power-loss persistence contract than the POSIX directory-flush path; the source states this limit.
- The new regression simulates Windows through a temporary platform override and file-system wrappers. It is a local synthetic test, not a Windows VM test. It checks the retained six-byte reservation, denied overflow, target binding, zero directory opens and one file flush. All process and file-system overrides are restored in `finally`. The existing test cases remain present.
- The launcher keeps `cmd.exe /d /s /c` and the actual packaged `.cmd` entry point. Its command now has the outer quote pair required by `/s /c`. `windowsVerbatimArguments: true` prevents Node from adding another escaping layer. Absolute-path and command-expansion rejection remain intact.
- Launcher output is drained and classified from at most 8192 bytes. Only fixed class labels, approved spawn-error codes and an integer exit code enter the summary. Raw output and secret strings do not enter the report. Existing bounded Quit and process-tree cleanup remain intact.
- Every workflow Node command now checks `$LASTEXITCODE`. A failed native suite stops the step before a later command can hide its failure. The new delivery-limit test is in both the source closure and the workflow test command. Action pins, read-only permissions and bounded artifact upload are unchanged.
- The recorder assertion still requires the exact receipts directory. It now uses `path.join` to require the platform-specific separator. No assertion was removed or loosened.

Reviewed repair snapshot:

| File | SHA256 |
| --- | --- |
| `agentops-cli/src/lib/copilot/delivery-limits.js` | `d56c07ec8554a7ba93dc671df93dc916aa5dec419aa008f7b1452c1ac08809cb` |
| `agentops-cli/test/delivery-limits.test.js` | `ff5c9fcb3270ac4d9c8b845cefcd9c89aeb0fa677d41860015cabf231159c5ea` |
| `extensions/agentops-native/test/recorder.test.js` | `ef89a388220baae42845ff4a6ddf20edf17d27d2cdf3d52f900e3e120d9a6594` |
| `scripts/qualify-native-windows.js` | `78227dd58cb5ff9c93521780dbc252255d803c0e8bcfd0fdc0d20535e7e89ef3` |
| `scripts/test/qualify-native-windows.test.js` | `8b85585d81f89b4934d462632d7bb4811539571511d6232834a399efcc5b8dc5` |
| `scripts/fixtures/native-windows-ci.yml` | `66051ffc2f4e75ab34f7e475c072acd6b4feceebfdd3d95bb7cf85e277d062b1` |

No CI rerun, commit, push, cancellation or external write was made by this reviewer. The required next proof remains an actual Windows run that passes the full native suite, portable launcher, native fixture contract and cleanup checks.


## Second Windows failure and CRLF repair review

The parent reports run `37149018604` at `a25305634d6b615cbc3a85ca3b1ca6b272b154dc`: 65 native tests (64 passed, one skipped), 19 focused tests (18 passed, one skipped), zero failures or cancellations. The portable launcher and Collector started. Native qualification still threw before its receipt contract completed. These counts are parent-provided here; the reviewer did not independently read this second run log.

The source cause is reproducible: Windows checkout line endings leave CRLF in the strict YAML. `scopedConfig` did not inject the scoped telemetry reader because its service matcher required LF. The external scope check also required an LF-only HTTP endpoint block. The repair changes only CRLF pairs to LF before these existing checks.

Result: no open P1 or P2 finding in the seven reviewed repair files. Zero reviewed files were skipped. Existing source was compared against exact baseline `a25305634d6b615cbc3a85ca3b1ca6b272b154dc`; the workflow template was compared against baseline `.github/workflows/ci.yml`. Existing lifecycle tests absent from that published snapshot reuse their earlier source review; the new CRLF test was read in full.

- Exact HTTP IPv4 loopback endpoint and port checks remain unchanged. Private receipt, directory ownership, strict privacy processor and local receipt exporter checks remain unchanged.
- The new strict-template regression proves CRLF and LF produce the same config. It checks all four scoped endpoint ports, the telemetry reader, the privacy processor and receipt exporter. An all-interface replacement is rejected. The external-scope test accepts CRLF but still rejects the wrong port and remote export.
- Native qualification still requires the original trace, agent, chat, tool, parentage, canary and execution evidence. No required assertion was removed or weakened.
- New native exception diagnostics return only three fixed classes. Error messages, paths and tokens are not copied into the summary. Existing bounded cleanup is unchanged.
- The source closure and workflow add the scoped Collector test file. Every Node command retains its explicit failure check. Existing lifecycle, shutdown and output-limit coverage will now run on Windows as well.

The worker reports all 34 focused local tests passed. The reviewer read the exact delta and tests and checked scoped whitespace; the reviewer did not rerun CI, commit, push, cancel a run or change external state. Actual native Windows qualification remains required.

Reviewed CRLF repair snapshot:

| File | SHA256 |
| --- | --- |
| `agentops-cli/src/lib/copilot/scoped-collector.js` | `2b9112de0af8db2e39dbcd1346a39bbd8dcc55eb10958e4a123906bf1ac0d14b` |
| `agentops-cli/test/scoped-collector.test.js` | `8b3cf8affc28e08255b74762563673c79065fc44e86287e272b76a042ecfa893` |
| `scripts/qualify-native-cli.js` | `406ba53b37957ce5caecfffc4ed109db315d3d56bafcb6f822fbb599903eae06` |
| `scripts/test/qualify-native-cli.test.js` | `568900f08e92092fe1de7ca5122ba2043caceb6ceb962b23179671302399c916` |
| `scripts/qualify-native-windows.js` | `9c73c8935f72771a92f56feb8a9fd31fce8877b73a4bc81989ab553a73cc1552` |
| `scripts/test/qualify-native-windows.test.js` | `d5f658bdd6566940d0c9b25b23141e104b8377b1283f94d524af3fc881d1a234` |
| `scripts/fixtures/native-windows-ci.yml` | `c0c99f9af5d2928ec2b857ddacfc257323ec53dca8c29dac84ad4a8dd1bc8974` |


## Third Windows failure — cancellation test timing repair

The parent reports run `37149602566` at `3261bce33f49e91a5aafc274d2e615bbaa7e7730`: the 65-test native suite passed its required checks, but the newly included cancellation regression failed because child exit metadata was not set when the production PID poll completed. The workflow correctly stopped before native runtime qualification. These third-run observations are parent-provided here, not an independent log readback.

One test file was compared against exact baseline `3261bce33f49e91a5aafc274d2e615bbaa7e7730`; zero files were skipped. No product source changed. Result: no open P1 or P2 finding.

The repaired test registers the child exit listener immediately after spawn, before the message listener can trigger cancellation. It still requires `AbortError`, and now also requires a physical PID probe to fail with `ESRCH`. It permits at most two seconds for Node to report the already terminated child's exit event. The timer is cleared in `finally`. The original exit metadata and removed-artifact assertions remain required. No test is skipped, weakened or muted.

The worker reports all 34 focused local checks passed. This source review confirms a stronger termination contract rather than replacement of the failed assertion. Actual Windows execution remains required. The reviewer made no remote action.

Reviewed test SHA256: `agentops-cli/test/scoped-collector.test.js` — `cb1ba991bfc7448a3eaad19a43fdac3a9f60e1e1ebbf1089b6915511a0967a5c`.


## Fourth actual Windows run — independently verified success

Independent GitHub readback confirms [run 37149760874](https://github.com/c-mongan/copilot-cli-agentops-azure/actions/runs/37149760874) completed successfully at exact head `bceeb76e09fb9dce24b36d4fd0b690823d2db48e`. Both the fixture step and real native runtime step succeeded. The log identifies Microsoft Windows Server 2025, x64. The runner used Node `v20.20.2`; the companion used the pinned VS Code Node runtime `v24.21.0`.

The native suite reported 65 tests: 64 passed, one skipped, zero failures and zero cancellations. The focused suite reported 34 tests: 33 passed, one skipped, zero failures and zero cancellations. The workflow retains explicit failure checks after each command.

The reviewer fetched the published bounded summary artifact `11283910710` and compared its bytes with the parent's local summary. They match exactly. Summary SHA256: `995f7727c790c286913f9e8e8bf5ad4bbb0857611c5c0aa01cb4ce723b430590`.

Verified summary results:

- Pinned native Copilot CLI `1.0.91` and Collector `0.151.0` ran with the synthetic local provider. Collector release checksum verification succeeded.
- The actual Windows portable `.cmd` launcher started the companion. It exited with code zero after Quit.
- Native capture and tool qualification passed. The receipt contains four spans in one trace with `invoke_agent`, `chat` and `execute_tool`. The qualification contract requires child spans to link to the agent and the fixed tool to execute.
- The privacy canary was observed before filtering and absent after filtering. The console canary was observed separately.
- Quit removed the owner process and capture lease. The summary reports `stage: complete` and `passed: true`.

This proves the bounded headless Windows runtime contract on Windows Server 2025. It does not prove desktop browser interaction, normal user installation/profile behavior, no-CLI Azure sign-in, cloud delivery, paid-model quality or diagnostic value. The summary explicitly leaves desktop, normal-profile and Azure qualification false and paid-model use false.

The reviewer performed only readback and wrote this owned report. No dispatch, rerun, commit, push, cancellation or cloud mutation was made.
