# EV-20260818-039 — Stage 4 seven-gateway hotfix rollout

## Identity and scope

- `evidence_id`: `EV-20260818-039`
- `evidence_type`: `E-ACCEPTANCE-HOTFIX`
- `recorded_at`: `2026-08-18`
- `result`: `PASS` for the bounded interim hotfix acceptance described below.
- `contract_fix_commit`: `6f24e83352fdb8d151e0a7442806152b3bf8060e`
- `capacity_purchase_fix_commit`: `3c89be965efb4f977fb29f004efab5293b3c275a`
- `deployable_artifact_commit`: `50d264a55dc3d5c0879e05c0c4ea0c53349fdeba`
- `package`: 211797 bytes; SHA-1 `0a1e94dc7229d5545cc946a95a4362325a48a7cc`; SHA-256 `f523b29c83ecada404cbce08cd783e38828a46f60668de1473a288e9e7669787`; 74 allowed runtime entries.
- `active_mapping_sha256`: `db9a4af356f8f482edd27013cbe154206e0e266d7fe7d0665be4a74df3cb086b` on the local artifact and all seven gateways.
- `secret_value_count`: 0

This is an interim Stage 4 hotfix acceptance only. It is not Task 18 candidate acceptance, does not complete any stage, and does not authorize release promotion, tagging, or a ledger-status change.

## Local package gate

The recorded local gate passed with Node `24.15.0`: Vitest `41 files / 1001 tests`, TypeScript no-emit and build, diff check, archive audit, and two-pack byte-identity checks. These checks bind the reported deployment to the immutable artifact identity above.

## Sanitized gateway result matrix

| Gateway scope | Plugin state | Verified result |
|---|---|---|
| gateway-01 | enabled, version `0.1.0`, healthy | Full eight-action sequence passed: `record_meal` returned `committed_with_issues` with `committed=true`; `correct_record` committed with `change_amount`; `query_meals` returned the synthetic test event at `200000000` microunits; `undo_record` committed with `void_event` using the frozen accepted phrase; `record_water` committed; one-layer `add_inventory` committed; `query_inventory` showed the synthetic milk item at `500000000` microunits in ml; `query_daily_summary` returned `read_only_result`. |
| gateways 02–07 | each enabled, version `0.1.0`, healthy | Each `record_meal` → `correct_record(change_amount)` → `query_meals` smoke passed and returned its synthetic test event at `200000000` microunits. |

All seven environments had enabled configuration, an existing private runtime root, an initialized SQLite database, and an authority-secret file. No concrete paths, identifiers, credentials, tokens, headers, endpoints, authority-secret material, or non-synthetic dietary data are recorded here.

## First-install finding and bounded conclusion

On a fresh gateway, plugin installation failed schema validation when the plugin configuration entry lacked `official_data_root`. Adding the required plugin entry satisfied CLI schema validation, but calls remained `PLUGIN_RUNTIME_UNAVAILABLE` until the configured official root existed. Creating a backend-owned dedicated root as the container runtime user with mode `0700` made the same smoke test pass.

This confirms the current schema semantics: the configured root is an existing absolute runtime root. It is an interim manual-environment prerequisite only, not a public installation interface. Task 15 must provide the installer preflight and transactional behavior recorded in `docs/work-items/INSTALL-FIRST-RUN-001.md`; direct configuration editing must not become the public installation procedure.

## Cleanup and boundaries

Rollout transfer files were deleted from each host and container. Installed npm projects and data roots remain. This record neither repeats access material nor claims a remote action beyond the already completed, sanitized acceptance results.
