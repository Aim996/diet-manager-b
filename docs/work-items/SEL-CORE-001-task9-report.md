# SEL-CORE-001 Task 9 OpenClaw report

Date: 2026-08-14 Asia/Shanghai
Source candidate before the formal build: `b4c5010f969408ec6cdf564e3eaec65d28abe82b`

## Implemented boundary

- `diet_manager` is registered through the real OpenClaw tool-plugin SDK and calls `createCoreRuntime` plus `handleCoreRequest`.
- `official_data_root` comes only from the resolved plugin config. Model/caller parameters cannot supply a root, secret, token, revision, or `prior_context`.
- The public schema remains compatible with the foundation request shape: only `action` is required; legacy `operation_id`, `source_text`, `occurred_at_text`, and `items`, plus the new application evidence fields, are optional and extra fields are rejected.
- A write requires all seven Task 8 application-authority fields. A legacy-only request returns `APPLICATION_AUTHORITY_REQUIRED` before runtime acquisition and creates no files. Legacy `items` and `occurred_at_text` are accepted only for compatibility and never become fact authority.
- PRODUCT-0.1 supplies `prior_context=[]`. It does not expose caller-authored context or revision authority and does not claim complete public context wiring.
- Runtime/root/config state is private in `src/openclaw/plugin.ts`; the module exports only the plugin entry and its parameter schema. The separate file is required to keep `src/index.ts` as the stable public facade without exporting runtime, root, execute, or cleanup capabilities.
- Lifecycle ownership is reference-counted across plugin APIs that share a Task 8 runtime. Arbitrary non-plugin holders of the deep Task 8 runtime API are outside this plugin lifecycle ownership boundary.
- `package.json` was renamed from the obsolete private foundation package identity to `diet-manager-b`, matching the manifest, plugin id, and Skill. The frozen business contract id/version/hash did not change.
- The obsolete non-writing `handleFoundationAction`, `FoundationOutcome`, and `foundation_not_implemented` development status were removed. The compatible public request/item types were retained.

## TDD and review evidence

- Initial real registered-tool RED returned `foundation_not_implemented`; the meal path then committed through the real SQLite runtime.
- Exact/proxy/root authority REDs covered caller root/token/revision fields, proxy trap zero, unavailable roots, Windows physical-root identity, and config drift.
- Three lifecycle-isolation REDs demonstrated that cleanup, cross-root drift, and lifecycle registration failure could close another plugin API runtime. The reference-counted fix made all three green.
- Compatibility review found the required §5.5 public-schema P1. The RED was 4 failed / 21 passed; the compatible schema and authority-required zero-write boundary made it green.
- Quality review found the revoked-Proxy P1. The RED was 1 failed / 18 passed with a native `IsArray` exception; proxy-first detection and bounded identity extraction made revoked request/config, accessor, and nested-evidence pressure tests green.
- Final focused: 2 files / 29 tests passed.
- Final affected, single worker: 9 files / 545 tests passed.
- Final full, single worker: 20 files / 788 tests passed.
- TypeScript `--noEmit` and `git diff --check`: exit 0.
- Pinned Node residue after the gates: 0.
- Independent specification rereview: READY, remaining P0/P1 none.
- Independent quality/security rereview: READY, P0/P1/P2 = 0/0/0.

## The single formal build

- Command: pinned Node v24.15.0 running `node_modules/typescript/bin/tsc -p tsconfig.json`.
- Local start/end: `2026-08-14T00:49:36.8866504+08:00` to `2026-08-14T00:49:40.6122966+08:00`.
- UTC start/end: `2026-08-13T16:49:36.8876349Z` to `2026-08-13T16:49:40.6122966Z`.
- Exit: 0.
- Source files: 44; hashes were identical immediately before and after emission.
- Dist files: 24 before, 44 after.
- Post-build source aggregate SHA-256: `A8D00515A9B3F0D89E0EC428A7E92ABC0B26EF519B7361F6A3D695608DF5077D`.
- Post-build dist aggregate SHA-256: `8C6A54A2E01FA4DD5A72654FD5711973B4FFB93E1530A0DE79D574503DF75DF0`.
- Source/dist module parity: 44/44, missing 0, extra 0.
- No second emitting build was run. No `src` or `tests` file was changed after this build.

Modified dist paths (13):

- `dist/contracts.js`
- `dist/domain/effect-bundle.js`
- `dist/domain/read-model.js`
- `dist/domain/receipt.js`
- `dist/domain/rules.js`
- `dist/domain/service.js`
- `dist/index.js`
- `dist/preview/store.js`
- `dist/repository/envelope-finalize.js`
- `dist/repository/fact-commit.js`
- `dist/repository/progress-reservation.js`
- `dist/repository/query.js`
- `dist/storage/database.js`

New dist paths (20):

- `dist/application/command-handler.js`
- `dist/application/core-runtime.js`
- `dist/application/mapping.js`
- `dist/application/outcome.js`
- `dist/application/runtime.js`
- `dist/authority/meal-fact-identity.js`
- `dist/authority/meal-fact.js`
- `dist/authority/offset-timestamp.js`
- `dist/authority/water-fact-identity.js`
- `dist/openclaw/plugin.js`
- `dist/parser/completion.js`
- `dist/parser/context.js`
- `dist/parser/input-authority.js`
- `dist/parser/liquid.js`
- `dist/parser/meal.js`
- `dist/parser/parse-command.js`
- `dist/parser/predicate-frame.js`
- `dist/parser/subject.js`
- `dist/parser/time.js`
- `dist/parser/types.js`

## Isolated OpenClaw validation

The first no-emit OpenClaw CLI attempt did not reach plugin validation. This worktree's pnpm junction for locked `@clack/prompts@1.6.0` pointed at an absent package directory, so the local OpenClaw 2026.7.1 CLI exited 1; validate was not run in that attempt. No dependency installation or repair was performed.

The bounded rerun used the complete OpenClaw 2026.7.1 CLI already present in the approved `b-merge-c-001` worktree, while `--root` and `--entry` still targeted this exact Task 9 candidate. It returned:

- `Plugin metadata is up to date.`
- `Plugin diet-manager-b is valid.`
- build-check exit 0; validate exit 0.
- Local start/end: `2026-08-14T00:52:24.9343751+08:00` to `2026-08-14T00:53:24.4999124+08:00`.
- The isolated state root contained only its `state/openclaw.sqlite`, was removed exactly, and pinned Node residue was 0.

## Post-build audit

- Candidate source/tests/config/Skill match the frozen `b4c5010` tree exactly.
- Production source/config/Skill/dist contain 0 private-LAN IPv4 literals and 0 credential-value patterns. Two pre-existing test fixture matches were excluded from the production scan.
- Dist default import is a registered tool plugin; public exports and the deep OpenClaw module expose no runtime/root/execute capability.
- Dist metadata and config schema match `openclaw.plugin.json`; the sole tool remains `diet_manager`.
- No remote instance, user Gateway key, push, install, or deployment was used.

This report closes Task 9's build boundary only. It does not claim final SEL-CORE installability or Task 10 closure.
