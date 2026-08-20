# EV-20260811-012: SH-SAFE-BASE-001 bounded exit acceptance

Date: 2026-08-11 (Asia/Shanghai)

## Decision boundary

This evidence closes `SH-SAFE-BASE-001` only under `DEC-028`: retain controls that protect business-data integrity, path containment, cleanup authority, report truthfulness, and caller state isolation. Windows-only process-count polish such as the signed system `conhost.exe` count mismatch is deferred and was not used as a pass condition.

This is not a release, G1, G2, G3, installation, or product-readiness result. It does not claim that the historical 48-case matrix passed on this candidate.

## Frozen inputs

| File | SHA-256 |
|---|---|
| `shared/private/foundation-validation-core.ps1` | `E921FBB889C9AF46397E6DEDC918CACAC7AE68D1D2819DEB218A1B22DCFFBED7` |
| `shared/tests/validate-data-manifests.ps1` | `8309CBF6A92FDF17959071D3719189AED72E5F22439345C5C5DD1C2D35E4A591` |
| `shared/validate-foundations.ps1` | `2A6D5801952F3CF67E025B782716EE937AFAFF623FCCDC1106B9D9641D719F61` |
| `shared/tests/validate-foundations-state-isolation.ps1` | `574E4F67BCF75D74A57FA8805CAA1C90990E3DCA3D60C58CFB4424B83E5F11C9` |

All four files passed PowerShell parser checks with zero errors and contained zero non-ASCII bytes. `validate-data-manifests.ps1 -LibraryOnly` exited with code 0.

## Focused acceptance

All cases ran serially in fresh Windows PowerShell 5.1 processes. The safety harness did not invoke real Node, npm, Vitest, TypeScript, OpenClaw, or esbuild processes.

| Case | Result | Elapsed | Product risk covered |
|---|---|---:|---|
| `RED-ROOT-005` | PASS | 15,735 ms | path escape, junction/reparse no-follow, zero external-target writes |
| `RED-TEMP-001` | PASS | 170,486 ms | four-root cleanup failure, adapter lie-zero, ordinary/reparse physical residual authority |
| `RED-REPORT-005` | PASS | 61,494 ms | report/publisher truthfulness, deep roundtrip and out-of-band evidence identity |
| `RED-MANIFEST-001` | PASS | 29,039 ms | business candidate and sidecar discovery without runtime-snapshot contamination |

Each focused case exited with code 0 and left zero `sh-safe-fixture-<guid>` directories.

## State isolation

`shared/tests/validate-foundations-state-isolation.ps1` passed 4/4:

- `RED-OPENCLAW-001`
- `RED-OPENCLAW-002`
- `RED-ENV-001`
- `RED-ENV-002`

Summary: `passed=4`, `failed=0`; process exit code 0; fixture residual 0.

## Data hygiene

After the bounded acceptance, a filename-only scan outside protected lease files found zero project business candidates with these suffixes: `.jsonl`, `.sqlite`, `.sqlite3`, `.db`, SQLite WAL/SHM sidecars, and `.journal`. Test-owned fixture residual was also zero.

## Accepted outcome

`SH-SAFE-BASE-001` is accepted for the risk-bounded completion boundary in `DEC-028`. The next product gate remains closed until `SH-MAP-001`, `SH-HARNESS-001`, and `SH-TRACE-001` have accepted current outputs. No production business table or migration is authorized by this evidence alone.
