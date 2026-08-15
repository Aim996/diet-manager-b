# Nutrition Source Capability Contract v1

## Identity

- `contract_id`: `diet-manager/nutrition-source-capability-v1`
- `contract_version`: `1.0.0`
- `registry`: `shared/nutrition-source-registry.json`
- `route`: `B`
- `default_network_access`: `deny`

This contract implements PRODUCT 0.3 §13.1—§13.19. The registry is the only priority authority; adapters
must not carry a second rank table. Research, broad web search, login/cookie automation and model memory are
not nutrition sources.

## Capability shape

Each enabled implementation returns one frozen exact capability:

```text
source_id
tier
rank                       # integer 1..8, identical to the registry
backend_id
backend_version
network                    # boolean
request_fields[]           # ordered subset of the global allowlist
license_id | null
cache_policy_id
probe_kind
```

Allowed health/resolve statuses are exact:

```text
ok | no_results | partial | timeout | auth_failed |
skipped_unconfigured | source_disabled | error
```

Unknown fields remain `null`; no status permits an adapter to substitute zero. Adapter data is untrusted and
must be ordinary exact JSON before it can enter evidence.

## Tier traversal

The client traverses registry ranks exactly once in this order:

1. `current_exact_label`
2. `manufacturer_or_exact_product`
3. `confirmed_same_product_history`
4. `authoritative_public_database`
5. `allowlisted_trusted_internet`
6. `versioned_common_dish_template` — activated personal template first, then common template
7. `generic_estimate`
8. `unknown`

Within each tier the only valid order is current local evidence → compliant unexpired tier cache → enabled
network adapter. A lower tier never fills a field that conflicts with an applicable higher-tier result. A
partial higher-tier result may retain its known fields while missing fields remain unknown; cross-tier merging
requires a later explicit correction and is not implicit resolution.

## Three implementation families

- `LocalEvidenceAdapter`: exact label, exact confirmed history, activated personal template, versioned common
  template and bounded generic estimate, each exposed at its own registry tier.
- `FoodDataCentralAdapter`: fixed official HTTPS origin, authoritative public database tier, credential
  capability required for live calls, fixture transport in tests.
- `TrustedExactProductAdapter`: separately allowlisted manufacturer exact-product entries and enabled
  Open Food Facts exact barcode entries. It never becomes open web search.

China CDC stays `disabled_pending_authorization` until its registry entry and license authority change.

## Request and transport authority

External requests are rebuilt only from this ordered allowlist:

```text
normalized_food_name, brand, variant, package_specification,
raw_cooked_or_processing_state, minimum_food_category, region_language
```

Original utterance, conversation, user/operation identity, meal date/time, inventory, storage, database path,
credential reference/value, authorization header and raw response are forbidden. A source may narrow the list
but cannot add fields. Origins and redirects are source-specific allowlists; HTTPS, response byte limits,
content type, timeout and abort are mandatory.

All nutrition resolution shares one deadline: default `2000ms`, accepted range `500..5000ms`. Each adapter
receives only the remaining time and a shared `AbortSignal`. A late result has no write authority.

## Configuration and credential boundary

Trusted plugin configuration contains exact ordinary non-secret fields only:

```text
policy_version
resolution_deadline_ms
sources[]                  # source_id/enabled/backend/version/license config
credential_refs{}          # opaque reference, never a credential value
```

The private runtime resolver turns a reference into an in-memory capability. Secret values and refs do not
enter request digests, SQLite, Profile/Snapshot, logs, errors or Doctor. Normalized non-secret configuration
produces `source_config_digest`; runtime identity is physical official root plus this digest. Drift in a live
runtime fails closed with `PLUGIN_CONFIG_CONFLICT`.

## Cache, history and replay

Cache entries are scoped by source, tier, subject/variant, backend/version, policy/license version, basis,
retrieval/review time and retained-fields hash. Expired, revoked, incomplete or lower-tier cache cannot preempt
an applicable higher tier. Profiles and snapshots are immutable. A source refresh affects future resolution;
history changes only through an append-only nutrition supplement event.

The first owner of a `base_input_digest` holds a bounded, authenticated resolution lease. Same-key followers
reuse the first authenticated completed evidence; they do not issue a second request or compare a new dynamic
result with the winner. Expired claims may be taken over by generation CAS. Technical effect retry uses signed
evidence and never reconnects to a source.

## Probe and Doctor

`probe()` performs the adapter's real lightweight readiness check under the shared deadline. `Doctor` calls all
configured probes independently and returns only source ID, backend/version, non-secret config identity,
status, stable reason and action. One failure cannot suppress another result. Doctor is read-only: it creates no
database, cache, config, browser state or scheduler.

## Stable degradation

- Missing/disabled config: `skipped_unconfigured` or `source_disabled`, then continue.
- Credential failure: `auth_failed`, never include credential text.
- Deadline: `timeout`, abort late work, then continue.
- Valid empty response: `no_results`, then continue.
- Partial valid response: `partial`, retain known fields and disclose coverage.
- Malformed/transport error: `error`, sanitized stable code, then continue.
- No reliable evidence: tier 8 `unknown`; occurred meal facts still commit.

## Change control

Source ID, tier/rank, backend family, allowlist, license, cache identity, deadline, public evidence label or
credential boundary changes reopen `SEL-NUTR-001` and require catalog, contract, Doctor and replay review.
