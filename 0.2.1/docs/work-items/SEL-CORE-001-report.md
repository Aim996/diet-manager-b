# SEL-CORE-001 Implementation Report

## Outcome

The selected core command slice is complete on product candidate `01e2b7b9d681ddc6dc0bcd15970dfc6de1ad801c`. The later commits `2493a0a03c9e8b865797218087686fadf9288ab3` and `429cfc21a4bf05e98a4fe47fe3771cb46a1f1a47` change only X-GATE provenance tests and metadata; product `src/**` and `dist/**` remain byte-identical to the reviewed candidate.

The slice provides a deterministic Chinese core parser, immutable meal and WaterEvent evidence, the existing SQLite FactCommit/EffectBundle/EnvelopeFinalize authority, a private-root application runtime, and a truthful OpenClaw `diet_manager` adapter. Terminal success is reported only after committed storage state and includes the actual event record ID.

## Exact case authority

- The selected catalog is version `1.5.0`, with 21 exact IDs in the frozen order.
- Twenty selected cases have command/parsing Oracles and are checked directly against the catalog.
- `CASE-RECEIPT-002` deliberately has no command/parsing Oracle. It is reachability-only in the parser and contributes only the two SEL-CORE receipt evidence-label paths. No meal disposition, rice/chicken structure, or public end-to-end result is inferred for it.
- `CASE-SCOPE-001` proves the excluded health-advice boundary: it is ignored with zero business writes. Its factual-query path proves existing facts remain available through the internal read model; it does not claim the later public query action is implemented.
- `full_case_set` remains `none`. This report proves the selected assertion paths, not 21 complete product journeys.

Exact assertion-path ownership is:

| Case | Bound paths |
|---|---|
| `CASE-MEAL-001` | `/oracle/command`; `/oracle/parsing/items`; `/oracle/fact_commit/meal_event` |
| `CASE-MEAL-021` | `/oracle/command`; `/oracle/parsing/items`; `/oracle/fact_commit/meal_event` |
| `CASE-MEAL-017` | `/oracle/command`; `/oracle/parsing/subject`; `/oracle/parsing/items`; `/oracle/fact_commit/meal_event` |
| `CASE-MEAL-009` | `/oracle/command`; `/oracle/parsing/items`; `/oracle/parsing/excluded_items`; `/oracle/fact_commit/meal_event` |
| `CASE-WATER-001` | `/oracle/command`; `/oracle/fact_commit/water_event` |
| `CASE-SCOPE-001` | `/oracle/command`; `/oracle/parsing`; `/oracle/factual_query`; `/oracle/business_effects` |
| `CASE-MEAL-002` | `/oracle/command`; `/oracle/parsing/items`; `/oracle/parsing/occurred_time`; `/oracle/parsing/purchase_evidence`; `/oracle/fact_commit/meal_event` |
| `CASE-PURCHASE-004` | `/oracle/parsing/time_anchors` |
| `CASE-RECEIPT-002` | `/oracle/receipt/explicit_fields_unlabeled`; `/oracle/receipt/inferred_fields_labeled` |
| `CASE-MEAL-010` | `/oracle/command`; `/oracle/parsing/completion_evidence`; `/oracle/parsing/items`; `/oracle/fact_commit/meal_event` |
| `CASE-MEAL-011` | `/oracle/command`; `/oracle/parsing`; `/oracle/business_effects` |
| `CASE-MEAL-012` | `/oracle/command`; `/oracle/parsing/items`; `/oracle/parsing/occurred_time`; `/oracle/fact_commit/meal_event` |
| `CASE-MEAL-013` | `/oracle/command`; `/oracle/parsing`; `/oracle/business_effects` |
| `CASE-MEAL-014` | `/oracle/command`; `/oracle/parsing/items`; `/oracle/parsing/occurred_time`; `/oracle/fact_commit/meal_event` |
| `CASE-MEAL-015` | `/oracle/command`; `/oracle/parsing`; `/oracle/business_effects` |
| `CASE-MEAL-016` | `/oracle/command`; `/oracle/parsing`; `/oracle/business_effects` |
| `CASE-MEAL-018` | `/oracle/command`; `/oracle/parsing/subject`; `/oracle/parsing/items`; `/oracle/fact_commit/meal_event` |
| `CASE-MEAL-019` | `/oracle/command`; `/oracle/parsing/subject`; `/oracle/parsing/items`; `/oracle/parsing/group_amount_evidence`; `/oracle/fact_commit/meal_event` |
| `CASE-MEAL-020` | `/oracle/command`; `/oracle/parsing/items`; `/oracle/parsing/context`; `/oracle/fact_commit/meal_event` |
| `CASE-WATER-003` | `/oracle/command`; `/oracle/parsing/items`; `/oracle/parsing/liquid_classification`; `/oracle/fact_commit/meal_event` |
| `CASE-WATER-004` | `/oracle/command`; `/oracle/parsing/items`; `/oracle/parsing/liquid_classification`; `/oracle/fact_commit/meal_event` |

## Delivered behavior

- Exact ordinary input authority, bounded completion/subject/time/context rules, predicate-event and occurrence ownership, and fail-closed ambiguity handling.
- Meal facts preserve source text, occurred-time, subject and context evidence. Unknown amounts remain null and produce an issue rather than zero.
- Plain water is stored as a distinct WaterEvent and contributes water exactly once; milk, soup, soy milk, coffee and tea remain meal items.
- Preview identity, stored fact evidence, terminal replay and query projection are authenticated and byte-bound for legacy meal, evidence meal and water paths.
- The application opens the fixed database and private authority secret lazily only for supported candidates. Ignored, clarification and unimplemented actions create no runtime files.
- The public OpenClaw adapter keeps the legacy parameter shape, requires the complete core authority before a write, never accepts a data root or secret from model parameters, and returns recursively frozen sanitized outcomes.

## Verification

Fresh serial closure gates used pinned Node.js `v24.15.0` and left no owned Node process or test root at family boundaries:

- selected catalog normal/self-test: `21` selected cases and `11` rejected mutations;
- selected parser/application/water acceptance: `8 files / 535 tests` passed;
- full plugin Vitest: `20 files / 788 tests` passed with one worker;
- TypeScript `--noEmit`: exit `0`;
- repository concurrency: same identity exactly twice, conflicts isolated, effects/finalizer exactly once, uncommitted crash invisible;
- progress-reservation base-change rejection: all business rows remained zero;
- crash harness: main plus `9/9` self-tests passed;
- shared validators/harness/B/fault families passed;
- isolated OpenClaw build-check and validate passed and their state root was removed;
- source/dist: `44/44` JavaScript modules, no missing or extra module, no production LAN endpoint or credential assignment match;
- formal build provenance: source `b4c5010f969408ec6cdf564e3eaec65d28abe82b`, single artifact commit `93d1fabcc2c90f42cb2ea295515d9636721b2c08`, Task 9 final `01e2b7b9d681ddc6dc0bcd15970dfc6de1ad801c`, execution count `1`, review re-execution `false`;
- X-GATE binds all `44` dist JavaScript paths, sizes and SHA-256 values, rejects source/dist post-build drift, and passed `18` identity plus `2` drift mutations.

The safe append-only raw gate capture is frozen at `docs/evidence/raw/SEL-CORE-001-task10-gate-v2-01e2b7b9.log`: `46,352` bytes, SHA-256 `8F6AFB1C01B7B215215DA0C215C4C8D3BE0DDC9D6930444540EC7DCD0C84FA40`. Every raw family recorded pre-transform length/hash and generic endpoint/credential-assignment scan counts before safe text was appended; the capture contains no configured private endpoint or secret. Post-closure local-map commands use a separate ignored capture so this digest remains immutable.

## RED/GREEN and exact change manifest

The implementation ancestry from base `307946c` to product candidate `01e2b7b` contains the reviewed Task 1–9 TDD commits. Important RED→GREEN boundaries include catalog `f442930→ddd0ce9`, input authority `415a819→c7fb515`, subject/time `88c686c→d377af3` and `903c641→c1419b9`, parser `f9b9006→16ab0ef`, meal evidence `27c257a→b2625bf`, WaterEvent `b7dbecb→1f16302`, application runtime `da9e099→d6638f4`, and OpenClaw `c5411da→b4c5010`. Each review fix is a non-amend commit and its focused RED/GREEN evidence is preserved in the ignored SDD ledger and the frozen Task 10 gate capture.

`git diff --name-status 307946c 01e2b7b` is the exact 97-path product change manifest: 3 planning/brief files; 9 shared catalog/harness validators; 32 generated dist paths; plugin metadata/package/Skill; 32 source paths; and 18 test paths. The exact path list is reproducible from those immutable commits and was checked with `git diff --check`. The two later tracked governance commits are separately bounded: `2493a0a` refreshes the X-GATE build identity, and `429cfc2` changes only the X-GATE matrix/validator/review test to bind all 44 build outputs.

## Data-root evidence

- No official user data root was opened. The protected official-root baseline and final manifest remained identical.
- Every plugin/database test family used a new ordinary test-owned isolated child; DB/WAL/SHM/private-secret/state leaves were removed at its boundary.
- OpenClaw check/validate used one isolated state root containing only the expected SQLite leaf; the state root was then removed and pinned-Node residue was zero.
- Reports record only portable relative leaves and test-owned root policy, not protected machine absolute paths.

## Independent review

- Spec/public review `/root/sel_core_task10_closure/sel_core_task10_spec_review`: `P0=0 / P1=0 / P2=0 / READY=YES`.
- Quality/security review `/root/sel_core_task10_closure/sel_core_task10_quality_review`: one provenance P1 was fixed by `429cfc21`; scoped rereview concluded `P0=0 / P1=0 / P2=0 / READY=YES`.

## Closure boundary

Trace normal/self-test and deterministic mirror generation run before the tracked closure commit. The exact closure-HEAD X-GATE map is then published as an ignored, reproducible, environment-bound local receipt. It is intentionally not embedded back into this tracked report or EV, because doing so would change the HEAD it authenticates.

## Explicit nonclaims

This slice does not implement public inventory, nutrition-source, issue, correction, progress, query or receipt workflows; does not prove `CASE-RECEIPT-002` is publicly recordable; does not claim installability, release, remote OpenClaw acceptance, or PRODUCT-0.1 readiness; and does not access official user data or any remote endpoint. The single next dependency-ready task is `SEL-PANTRY-001`.
