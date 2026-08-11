# SH-CONTRACT-004 Issue/Correction v2 Design

## Purpose

Upgrade the existing Issue/Correction companion contract to the approved total-plan 0.3 semantics without creating storage tables, repository code, platform-specific business logic, or a second runtime contract.

## Chosen approach

Upgrade `shared/contracts/issue-correction-contract.md` in place. Keep one human-readable normative document with one embedded machine JSON block. The machine block is the downstream Schema/mapping/harness input; prose supplies rationale, transaction examples, and golden receipts.

Rejected approaches:

1. Keep v1 and add a separate v2 file: rejected because two normative contracts would compete.
2. Put the new behavior into the OpenClaw plugin or Skill: rejected because adapters must stay thin.
3. Implement tables/repository first and derive the contract from code: rejected because M2 mapping and model gates are not complete.

## Frozen boundaries

- Upstream authority: `diet-manager/contract-v2` and `diet-manager/receipt-date-contract-v2`.
- Product write route: B only; Skill, OpenClaw, MCP, and future agents only adapt transport.
- Issue lifecycle: exactly `open`, `awaiting_user`, `resolved`, `dismissed`.
- Issue resolution: exactly `applied`, `no_change`, `rejected`; rejection reasons are fixed and separate from resolution reasons.
- Correction operations: exactly 13, including `change_food_type`, `void_event`, and `restore_event`.
- Transactions follow `FactCommit → EffectBundle → EnvelopeFinalize`; CorrectionEvent/outbox belongs to FactCommit, nutrition/inventory/Issue contributions belong to EffectBundle, and final progress/receipt belongs to EnvelopeFinalize. A later technical failure never rolls back an already committed fact.
- FactCommit failure may create an independent redacted technical log but creates zero dietary business data.
- Correction inventory insufficiency commits the corrected fact, recalculates nutrition, preserves the real prior deduction, skips the unsafe delta, creates an Issue, and reports `committed_with_issues`.
- Cross-day correction returns `daily_progress_by_date[]` for every affected date and no single-day alias.
- PRODUCT-0.2 batch correction/void requires a zero-write preview, revision-bound confirmation, per-target append-only execution, and one final EnvelopeFinalize.
- Mixed input is ordered, per-event idempotent, and reports the five CONTRACT-v2 statuses without a synthetic overall success.

## Verification design

An ASCII-only Windows PowerShell 5.1 validator parses the embedded JSON, checks exact arrays/property sets, verifies six current trace IDs as singletons, checks body anchors for the layered failure paths, and rejects legacy v1 state/operation/result structures. TDD requires a real missing-machine-block RED before the contract changes.

An independent OpenClaw review later receives the total plan, both upstream contracts, candidate, validator, brief, and report. It must review semantics and golden failure matrices rather than trusting the validator.

## Scope exclusions

- No Schema fields or database tables.
- No physical outbox implementation.
- No OpenClaw/MCP-only business behavior.
- No threshold policy values.
- No product records, migrations, or business data.
- No changes to the five protected lease files.

## Self-review

- No unresolved placeholders.
- One normative companion contract only.
- Status, operation, transaction, progress, and adapter boundaries match total plan 0.3 and CONTRACT-v2.
- Later model/mapping tasks can consume the machine block without inferring prose.
