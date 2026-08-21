# EV-20260821-046 — universal Agent Skill final verification

## Identity and verdict

- `evidence_id`: `EV-20260821-046`
- `recorded_at`: `2026-08-21`
- `scope_range`: `33478984b320ab8e8d96b9b14b77de071d0a39ca..HEAD`
- `verified_product_head`: `6f319a600bc27e1dadaf3d2a99c418da1fada110`
- `whole_branch_review_range`: `30676bda830055fbc4de19ab9059b77b8f680e40..6f319a600bc27e1dadaf3d2a99c418da1fada110`
- `local_result`: `PASS`
- `remote_result`: `PASS`
- `release_ready`: `YES`

The platform-neutral API, CLI, package, Windows/Linux persistence smokes, public Node API, optional OpenClaw adapter and authoritative local regression pass. Remote work ran only after renewed user approval in the parent task; the candidate and every test-only remote root were then removed and all three instances returned healthy with their configuration hashes restored.

## Runtime and static verification

- Windows runtime: Node `v24.19.0`, npm CLI `11.12.1`, Vitest `v2.1.9`, OS `Microsoft Windows NT 10.0.26200.0`, architecture `X64`.
- TypeScript `tsc -p tsconfig.json --noEmit`: exit `0`, no diagnostics.
- Focused command category (`agent-command`, CLI, public package, portable package, foundation): final exit `0`; `5/5` files and `78/78` tests passed.
- The first focused invocation had no `npm_execpath`, so all 24 portable-package cases rejected their test precondition while the other 54 tests passed. Binding the existing npm CLI and rerunning the same group produced the final `78/78`; no source or test file changed.
- Adjacent command category: exit `1`; `4` files and `102/102` collected tests passed, while three core suites could not collect because the known temporary `0.2.2/shared` fixture was absent. The authoritative run below supplied the already-documented ordinary fixtures and included those three suites successfully.

## One authoritative complete suite

Only one complete `vitest run` invocation was made.

- Before the run, ordinary temporary copies of the documented `shared` and `docs` fixtures were created inside `0.2.2` after boundary and reparse checks.
- `shared`: `96` files, `3,006,001` bytes, tree SHA-256 `66BBEEACC2C25F5B4C575B1A15C44F8430941E66D25BD56E5D196FB16DE204E3`.
- `docs`: `245` files, `3,223,156` bytes, tree SHA-256 `45428354CA12D39CB9F8B2612CCE483D395094E7BB548D6DA39981444DDD03FF`.
- Source and copied tree receipts matched before execution.
- Authoritative result: exit `0`; `72/72` test files and `1,322/1,322` tests passed; zero failures.
- Both exact fixture targets were subsequently checked as ordinary, worktree-contained directories and removed. Both removal checks returned `True`.

## Portable candidate

- TypeScript production build: exit `0`.
- Portable builder: exit `0`; receipt contained `88` lexically sorted allowed paths.
- Candidate: `diet-manager-b-0.2.2.tgz`, `246,888` bytes.
- SHA-256: `46BD83A4F9C6E77B99084BF3C4AFD397854D39F234F952D4A73CFCE51A03DB96`.
- npm integrity: `sha512-mdFKUQjIApFn2vq2klUeDecUmMi0vvSbukyFSnqoWYCuevs3RVdvQs+b4//yMPKLktDy7H6VV0BJVhRbX7g10g==`.
- The candidate was built in an ordinary controlled temporary directory. Its hash and size were re-read immediately before cleanup; the complete Task 6 temporary root was then removed and the targeted tarball residue count was `0`.

## Real Windows standalone smoke

The compiled CLI was invoked as a fresh Node process for each step, with no OpenClaw entry, process, WebUI or adapter loaded. Standard input/output/error were explicit UTF-8.

- `record_meal`: `committed=true`, status `committed_with_issues`.
- `record_water`: `committed=true`, status `committed`.
- `query_meals`: `1` meal.
- `query_daily_summary`: meal count `1`, water count `1`.
- `undo_record`: committed `void_event`.
- `restore_record`: committed `restore_event`.
- A later fresh process queried the same root and returned `1` meal.
- Independent read-only `node:sqlite` verification: `event_records=4`, `active_events=4`, `meal_items=1`, `correction_events=2`, `void_event=1`, `restore_event=1`. Event grouping was one meal, one water and two correction audit events.
- A harness diagnostic proved that default Windows process stdin encoding corrupts non-ASCII JSON (`DIET_AGENT_CLI_INVALID_INPUT`), while explicit UTF-8 and an ASCII control both work. The official reference already prescribes explicit UTF-8; no product change was required.
- The smoke data root was checked as an ordinary controlled temporary directory and removed.

## Linux and OpenClaw environments 01/02/03

Status: `PASS`.

### Baseline and platform facts

- Transport was limited to interactive SSH/SCP and one router-side temporary root after renewed user approval. Credentials stayed in the interactive session and were not written to commands, files or evidence. WebUI was not used.
- Router: iStoreOS, Linux `6.6.144`, `x86_64`.
- Environments 01/02/03: Node `v24.16.0`, OpenClaw `2026.7.1`; all were running before the test and reported zero installed Diet Manager plugins.
- The remote candidate SHA-256 was `46BD83A4F9C6E77B99084BF3C4AFD397854D39F234F952D4A73CFCE51A03DB96`, byte-identical to the local candidate.

### Environment 01 — standalone CLI

- The candidate was unpacked under a test-only package root and used a new test-only data root.
- `record_meal` with the synthetic input “我吃了两个鸡蛋” returned `committed_with_issues`, `committed=true`.
- A new CLI process ran `query_meals`, returning `ignored/read_only` with one meal.
- Independent SQLite counts: `event_records=1`, `meal_items=1`, `idempotency_records=2`, `command_envelopes=2`.

### Environment 02 — public Node API without OpenClaw

- The public `dist/index.js` root imported with `rootDefault=false`; the OpenClaw entry was not resolved.
- `executeAgentCommand(record_water)` returned `committed`, `committed=true`; `query_daily_summary` returned `ignored`, `committed=false`.
- Independent SQLite counts: `event_records=1`, `idempotency_records=1`, `command_envelopes=1`.
- Repeating the same idempotent write returned exactly the keys `action`, `committed`, `operation_id`, `record_id`, `status`.

### Environment 03 — real optional OpenClaw adapter

- Before mutation, the instance configuration, last-good state, npm state and plugin Skill state were archived on the same host and hashed.
- The official plugin installer installed the candidate into the real extension mechanism and linked the OpenClaw peer. Initial loading failed closed because required `official_data_root` deployment authority was absent.
- Only after backup, the plugin configuration was pointed to a test-only root. Plugin status became `loaded`; after restart the gateway readiness check passed.
- The actual installed entry registered tool `diet_manager` with lifecycle `diet-manager-b-runtime`. A real `record_water` request returned `committed`, `committed=true`.
- Its public outcome keys exactly matched environment 02. Independent SQLite counts were `event_records=1`, `idempotency_records=1`, `command_envelopes=1`.

### Restoration and cleanup

- The official forced uninstall ran; the exact extension and plugin-Skill targets were realpath-validated before removal.
- Configuration was restored from the same-host backup. After restart, all three environments were healthy, plugin count was zero, and configuration discovery returned zero Diet Manager entries.
- Each environment's configuration SHA-256 exactly matched its pre-test baseline.
- All three container test roots, the router temporary root and the local candidate temporary root were verified and removed. No candidate tarball or test database remained.
- The three live OpenClaw state SQLite main-file hashes changed during CLI enumeration, restart and WAL checkpoint activity. These are volatile OpenClaw runtime databases, not Diet Manager business databases. No Diet Manager business database existed before testing; every Diet Manager write was confined to a test-only root that was removed. This evidence therefore does not claim byte-stability for live OpenClaw state SQLite files.

## Scope and repository state

- Before the evidence commit, the ledger-ruling implementation range contained `8` product commits and `26` changed paths: `2,901` insertions and `207` deletions. The final `3347898..HEAD` range additionally contains this evidence commit.
- `git diff --check 3347898..HEAD`: exit `0`.
- The broader pre-plan review range intentionally includes the approved spec/plan and contains `9` commits. Its diff check exits `2` only for three pre-existing Markdown hard-break trailing spaces in the approved design document; Task 6 did not modify that approved file.
- The implementation range contains no `0.2.1`, top-level `shared`, `node_modules`, SQLite, environment or secret path.
- Before this evidence file was added, `git status --short` showed only the pre-existing untracked `0.2.2/version-b-lite-plugin/dist/`.
- No Task 1–5 file required a RED/fix cycle during Task 6.

## Remaining limitations

1. No real macOS smoke was available; macOS is covered only by platform-neutral Node tests and the no-platform-shell package tests.
2. The direct adjacent invocation cannot be reported exit `0` without its documented fixture; its same suites passed inside the single authoritative run after controlled fixture preparation.
3. Live OpenClaw state SQLite byte hashes are not stable across ordinary runtime/WAL activity; the applicable safety proof is restored configuration equality plus isolation and removal of all Diet Manager business writes.
