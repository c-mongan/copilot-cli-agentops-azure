# CLI-first build verification: macOS and Windows

Date: 2026-10-03

The local preview captures native Copilot CLI telemetry on macOS and in a
headless Windows Server 2025 qualification run. Desktop Windows installation,
normal-user ACLs, rendered GUI use and uninstall remain release gates. The
preview requires installed Copilot CLI and VS Code or VS Code Insiders. Users
need no separate Node, AgentOps CLI, Azure CLI or Docker installation.

```text
Mac app / Windows launcher / VS Code extension
                  |
       start local strict Collector
                  |
Copilot CLI native OTel + selected Python / JS library spans
                  |
       filtered local receipt and report
                  |
       explicit VS Code sign-in or tested publisher credential
       and manual Azure metadata upload
       (one synthetic row proved; VS Code provider pending)
```

## Proof completed

| Check | Result | Limit |
| --- | --- | --- |
| Full CLI suite | 1,033 passed; one platform skip; zero failed | Local suite; not production proof |
| Final portable native runner | macOS checks passed; headless Windows run `37149760874` passed | Windows desktop GUI, normal-user ACL, install/uninstall and sign-in remain unverified |
| Library bootstrap checks | Nine passed | CJS, ESM and Python HTTP; compiled TS only |
| Strict Collector privacy | Real pinned Collector passed | Permitted metadata is not a universal secret detector |
| Native CLI emission | Four spans from CLI 1.0.91; one linked trace | Offline synthetic provider and fixed `printf` tool |
| Packaged Mac UI | Connect, receipt, report, Disconnect and Quit exercised | Synthetic provider; no paid model request |
| Local report | Four spans, one session, 24 input and 10 output tokens | Coverage and task outcome remain unknown |
| VSIX installation | Final package installed in an isolated profile | Normal profile was unchanged |
| Final VSIX real host | Synthetic span filtering, report creation, settings restore and Collector stop passed | Live Chat emission not tested |
| Real integrated terminals | All eight settings inherited; all absent after Disconnect | New integrated terminals only |
| Final VSIX source comparison | All 42 checked runtime files match source | Does not replace host execution checks |
| Static checks | 1,087 files passed | Static checks do not prove runtime behavior |
| Independent code review | No unresolved P1/P2 findings in reviewed scope | Scoped review; not whole-repository coverage |
| Headless Windows native qualification | Run `37149760874` passed on Windows Server 2025; four spans in one trace; capture/tool qualification passed; launcher exit 0; owner process gone; lease removed | Synthetic local provider; no paid model; desktop GUI, normal-user ACL, install/uninstall and sign-in remain unverified |
| Embedded Azure synthetic row | 473-byte request; HTTP 204; one row acknowledged; all 63 maintained fields matched by typed readback | Cached Azure CLI token was injected as the test credential; VS Code Microsoft provider and least-privilege RBAC remain unverified |
| Selected script host | Three HTTP library spans from Node/Python fixtures; supervised cancellation exercised | Dialogs were fixtures; no rendered wizard or report proof; no native Copilot spans |

Test counts describe separate checks. They must not be added as a unique test
total. Earlier unchanged suite results are reused where valid.

Artifacts and logs are under
`<agent-workspace>/artifacts/native-build-20261003/`:

- `cli-suite-final.log`
- `native-final-v3.log`
- `package-source-proof.json`
- `vsix-install-proof.json`
- `companion-v3-ui-proof.json`
- `companion-v3-report.png`

The `companion-v3` files are historical Mac GUI proof for the unchanged
Connect, receipt, report, Disconnect and Quit flow. They are separate from the
current v5 package outputs listed below.

The final VSIX SHA-256 is
`15cdb66ea7e96c68fd238477b128ca8af8d654d092ecc829adf89d5791fb14f3`.
Its path is
`<agent-workspace>/artifacts/agentops-native-vsix-20261003-cli-first-qualified-v2/agentops-local.agentops-native-0.1.0.vsix`.

Final extension-host proofs are under
`<agent-workspace>/artifacts/agentops-native-final-host-proof-20261003/`.
They use real VS Code APIs with fixture consent and synthetic telemetry.
Bundled Copilot development warnings are recorded separately; no AgentOps
check failed. Live Chat export remains unverified.

Final unsigned preview packages are under:

- `<agent-workspace>/artifacts/agentops-native-companion-macos-v5/`
- `<agent-workspace>/artifacts/agentops-native-companion-windows-v5/`
- `<agent-workspace>/artifacts/agentops-native-vsix-qualified-v4/`
- `<agent-workspace>/artifacts/agentops-native-package-manifest-v5/artifact-manifest.json`

The v5 artifact manifest records 37/37/46 source matches and extraction
checks. The Windows qualification summary also matched 69 qualification code,
asset and workflow paths with zero mismatches. The packages are unsigned
previews. The main checkout remained dirty and uncommitted; the reviewed
qualification snapshot used a separate dedicated branch.

## Repairs and coverage

The build repairs native settings restoration on routine host shutdown and
keeps a stable loopback endpoint. Explicit Disconnect restores only settings
that this setup still owns. Port conflicts fail closed.

The Collector retains approved native metric names and types. It removes
unknown metric series, scope metadata, schema URLs and trace state. It rejects
linked spans and exemplar-bearing points. This reduces coverage. HTTP and
database spans use fixed classifications. The filter removes URL and content
canaries in the qualified library checks.

A final browser check found that an idle preconnect socket kept v2 running
after Quit. The v3 repair closes idle connections without interrupting active
responses or pending setup. Five regression checks pass in Node and the actual
VS Code Electron runtime. The v3 packaged browser flow passed again with four
native spans. Both listeners closed, the process exited with code 0, and the
ownership lock was released while the browser remained open.

Capture stops at a sampled 12 MiB receipt-plus-log threshold. A write burst can
exceed that threshold. New capture is blocked at 32 MiB retained output or on
an unsafe storage scan. Retained data is not deleted automatically.

The Windows launcher accepts native PE files without applying Unix permission
bits. Native PATH lookup supports `copilot.exe`, including Winget links, with
an installed npm native-package fallback. It does not execute a discovered
`.cmd` or PowerShell lookup script. Windows ACL and signing remain unverified.

The first actual Windows CI run was
[37148214250](https://github.com/c-mongan/copilot-cli-agentops-azure/actions/runs/37148214250).
It failed portability checks before native fixture qualification. The main
suite reported 58 passed, 3 failed, 3 cancelled and 1 skipped; the separate
qualification suite reported 9 passed and 1 skipped. Repairs for Windows path
assertions, durable-spool directory flushing, batch launcher quoting and CI
exit-code propagation were reviewed. The repair checks passed locally as 65
native/repair checks plus 19 supporting checks. The later actual run was
[37149760874](https://github.com/c-mongan/copilot-cli-agentops-azure/actions/runs/37149760874)
at head `bceeb76e09fb9dce24b36d4fd0b690823d2db48e`. It passed the headless
native gate on Windows Server 2025 with real pinned Copilot CLI 1.0.91, VS
Code 1.140.0/Node 24.21.0 and Collector 0.151.0. It produced four spans in
one trace (`chat`, `execute_tool`, `invoke_agent`), passed capture and tool
qualification, observed the canary before filtering and removed it after
filtering, exited the launcher with code 0, and removed the owner process and
lease. The model provider was a synthetic local fixture; no paid model ran.
This does not qualify desktop GUI use, normal-user ACLs, installation,
uninstallation or sign-in.

Azure publishing requires explicit destination approval and Microsoft sign-in.
It uses a bounded durable queue and a metadata-only projection. Disabling
publishing cancels pending requests and blocks later token use. It cannot recall
bytes already sent. A separate authorized synthetic proof sent one 473-byte
request to the existing pilot, received HTTP 204, acknowledged one row and
matched all 63 maintained fields by typed Logs readback. The proof used a
cached Azure CLI token as an injected credential provider. It did not qualify
the no-Azure-CLI VS Code Microsoft provider, least-privilege RBAC, or a live
Copilot upload.

The selected project script host proof ran real Node and Python HTTP fixtures
through the real Collector and received three HTTP library spans. It also
exercised supervised cancellation. File selection, interpreter choice, module
choice and consent were fixture responses. A computer-use attempt could not
start the isolated native pipe (`native pipe startup failed`), so no rendered
wizard or report interaction was proved.

## Remaining release gates

1. Run the package through the remaining Windows desktop gate with a normal
   user. Check install, rendered GUI, report, restart, Disconnect, Quit,
   uninstall and retained-file ACLs. The headless native gate already passed.
2. Qualify VS Code Chat after reload with an actual Chat receipt. A ready socket
   or changed setting is insufficient.
3. Qualify Azure sign-in through the VS Code Microsoft provider, destination
   RBAC, ingestion and typed Logs API readback. The cached-token proof closes
   only the embedded transport and synthetic schema contract. Keep publishing
   manual until the user sign-in path passes. The first projection does not
   upload the full native waterfall or library spans.
4. Qualify the script wizard in the rendered extension UI. Library emission and
   wizard unit tests are separate evidence; fixture dialogs do not qualify the
   user flow.
5. Run the remaining Windows desktop qualification with a normal user. Record
   install, GUI, ACL, uninstall and policy results separately from the passing
   headless run.
6. Measure overhead and diagnostic benefit against a baseline with held-out
   tasks. Synthetic telemetry proves transport, not product usefulness.
7. Add signing, installer and optional enterprise startup/policy only after the
   corresponding target and authority are selected.

The current preview scopes telemetry to newly launched sessions and selected
project scripts. It does not inject instrumentation into every Python or JS
process. Existing terminals need a new session or separately reviewed policy.
No normal profile, OS policy, public release or cloud resource configuration was
changed. The synthetic Azure proof wrote one prepared event to the existing
pilot; it did not change resources or roles. No new cloud service is required
for the local preview. Azure ingestion remains chargeable when enabled; an
Azure budget is not a hard spending cap.

See the [build status](../plans/2026-10-03-cli-first-build-status.md),
[companion use guide](../native-companion.md),
[native CLI proof](2026-10-03-native-cli-proof.md),
[privacy proof](2026-10-03-safe-metrics-proof.md) and
[scoped review](2026-10-03-native-build-review.md).

## Transfer packages

- Mac: `<agent-workspace>/artifacts/agentops-native-companion-macos-v5/AgentOps-Native-Companion-mac-preview.zip`
- Windows: `<agent-workspace>/artifacts/agentops-native-companion-windows-v5/AgentOps-Native-Companion-windows-preview.zip`

Both archives passed integrity checks. They are unsigned previews. The archive
name alone does not establish desktop Windows GUI or normal-user proof; the
headless native result is recorded above.
