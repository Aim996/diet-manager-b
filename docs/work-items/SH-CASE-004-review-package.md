# SH-CASE-004 Independent Review Package

## Review objective

Independently determine whether the `SH-CASE-004` candidate is a deterministic, non-self-referential golden Oracle for eight selected receipt/progress/pending outcomes and whether the cumulative six-case append preserves all prior values.

Do not treat validator PASS text, declared hashes or structured `final_result` values as the expected receipt text. Do not claim that a renderer, SQLite repository, Skill installer, OpenClaw adapter or MCP server exists.

## Candidate identity

- branch: `agent/sh-case-004-golden-receipts`
- base: `b07df0461379f8998c14344e4d7e0087302665e7`
- implementation head: `7845ea5cf626ab27024c0444908d218351859f9c`
- review candidate: exact published branch head supplied with the review request
- status: `candidate_review_pending`

## Normative public inputs

- `总功能开发计划0.3.md`
- `docs/work-items/SH-CASE-004-brief.md`
- `docs/superpowers/specs/2026-08-12-sh-case-004-golden-receipts-design.md`
- `shared/contracts/business-contract-v2.md`
- `shared/contracts/receipt-and-date-contract-v2.md`
- `shared/contracts/issue-and-correction-contract-v2.md`
- `shared/acceptance-cases/cases.json`
- `shared/acceptance-cases/golden-receipts/manifest.json`
- eight `shared/acceptance-cases/golden-receipts/CASE-*.txt` files

## Required independent checks

1. Build an independent ordered eight-ID list and six-appended-ID list from the brief and normative contracts.
2. Compare the first twenty plain case JSON values independently with base `b07df046`; require exact value preservation and exact cumulative `20 + 6` order.
3. Recompute every golden text length and SHA-256 directly from bytes; reject BOM, CR, NUL, invalid UTF-8 and any terminal-newline error.
4. Compare `CASE-RECEIPT-001.txt` independently with the approved receipt/date contract example, byte for byte.
5. Check every manifest path is a unique repository-relative ordinary text path under the golden directory.
6. Verify exact receipt block order without generating expected text from `final_result`.
7. Verify six metrics and their fixed order for every successful day block; require single-day alias equality and forbid a multi-date alias.
8. Verify the evidence/options receipt distinguishes explicit from inferred data, provides two to four ordered options, a safe exit and the free-text route before progress.
9. Verify normal success contains no duplicate current-turn nutrition section or post-progress advice.
10. Verify requested analysis is factual, requested, before progress and contains no diagnosis or automatic advice.
11. Verify the single-item artifact has a separate title and one nonempty item line.
12. Verify cross-date retry is the original frozen two-date result after a later unrelated write, rather than current totals.
13. Verify the pending artifact exposes no success title, receipt data, progress, alias or terminal idempotency result.
14. Independently inject each of the twelve named weakening families and require the real candidate validator to reject it for a stable relevant reason.
15. Verify the three existing acceptance validators changed only for cumulative version/ID suffix compatibility; owned assertions, fixture version and mutation counts remain unchanged.
16. Run the ten permitted local validators with Windows PowerShell 5.1 and compare final stable lines.
17. Verify strict JSON, Parser/ASCII/CR/NUL, `git diff --check`, protected changed-path count zero, secret/machine-path count zero and temporary/business candidate residual zero.
18. Report P0/P1/P2 separately and explicitly state whether `SH-CASE-004` may close.

## Required mutation families

- valid text byte drift and CRLF
- dish component split
- explicit value mislabeled as estimated
- progress no longer last and advice after progress
- quick-option safe exit removed and free-text line changed
- retry recomputed from latest totals
- multi-date single alias and cross-date order reversal
- pending result exposing success data

## Severity

- `P0`: candidate authorizes partial dietary data on failed business write, exposes false success during pending, silently changes prior cases, touches protected files, or cannot run.
- `P1`: required artifact/case/mutation is missing, expected text is self-generated, byte authority is weak, replay/alias/options/pending semantics are wrong, or a realistic weakening survives.
- `P2`: documentation or diagnostics improvement that does not weaken the selected Oracle.

Completion requires `P0=0` and `P1=0`. P2 may be recorded for later work.

## Review independence and cleanup

- Review from a fresh isolated public clone at the exact supplied SHA.
- Do not edit candidate files.
- Do not use the candidate report as the sole expected source.
- Write at least one independent byte/structure checker from the normative public inputs.
- Do not read, hash, edit or execute protected domain lease files.
- Remove the isolated clone after checking ownership, symlink/reparse state and exact target.
- Return one machine-readable final line:

```text
SH_CASE_004_REVIEW|PASS_OR_FAIL|P0=<n>|P1=<n>|P2=<n>|sha=<exact_sha>|cleanup=<0_or_1>
```
