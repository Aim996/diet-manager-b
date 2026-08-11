# SH-MODEL-001 Independent Review

## Scope

Independent semantic review of the frozen Event/Amount/Product/Inventory schemas, the fixed fixture corpus and the PowerShell cross-field evaluator. The reviewer was instructed not to trust local GREEN or candidate descriptions.

## Round 1

Result: `PASS`, P0=0, P1=0.

The reviewer accepted the schema-freeze boundary without requiring a third-party runtime, but identified seven nonblocking quality findings. Two were treated as required corrections because they contradicted the frozen business contract:

1. completed business objects allowed `result_status=failed`, although failed FactCommit may create only a separate technical log;
2. relative cross-file `$ref` values did not resolve to the declared Event schema `$id` under standard draft 2020-12 resolution.

The candidate was also strengthened to reject extra properties, empty required provenance and partial authorization from a different source message. Approximate time and vague amount cases were added, and fixture bytes were pinned.

Round-1 completion marker:

```text
Ready for SH-MODEL-001 completion: Yes
```

## Round 2

Result: `PASS`, P0=0.

The second reviewer started from the complete revised schemas, fixtures and evaluator. It independently installed Ajv 8.20.0 plus `ajv-formats`, registered both schemas by `$id`, and executed draft 2020-12 validation:

- expected-valid: `20/20` passed schema validation;
- expected-invalid: `16` rejected at schema level and `5` intentionally rejected by semantic rules only;
- total fixed cases: `41/41` matched expected outcome and error boundary;
- cross-resource `unevaluatedProperties` and the absolute Event schema refs resolved correctly.

The only P1 was an environment limitation: the review session did not have the repository or PowerShell and therefore could not prove pasted text byte-for-byte equal to local files. The real repository closed that action with a fresh validator run and SHA recalculation:

```text
CORE_MODEL_SCHEMAS|PASS|version=1.0.0|cases=41|event_defs=6|inventory_defs=6|mutations=4
```

Nonblocking follow-up items recorded for the later runtime-validator task:

- replace the duplicated time-separation positive case with a distinct boundary;
- add positive fixtures for stock return, vendor return, discard, depleted, date precision and approximate amount;
- define arbitrary-precision decimal behavior and minimal decimal canonicalization;
- register `x-schema-version`, enforce date/date-time formats and load both schemas through an explicit `$id` registry;
- retain cross-field semantic enforcement at the production write boundary.

Round-2 completion marker:

```text
Ready for SH-MODEL-001 completion: Yes
```

## Closure decision

SH-MODEL-001 may close as a schema-freeze task. It does not claim that the current PowerShell evaluator is the production write-boundary validator, does not create SQLite tables, and does not claim G1/G2/G3 or product readiness.
