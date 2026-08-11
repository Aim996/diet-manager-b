import { canonicalSha256 } from "../authority/canonical-json.js";
import { assertCurrentMigrationAuthority } from "../storage/migration-guard.js";
export function computeRepositoryDataRevision(database) {
    assertCurrentMigrationAuthority(database);
    const events = database
        .prepare(`SELECT
        event_id, envelope_id, operation_id, schema_version, event_type, fact_kind,
        committed_at, result_status, lifecycle_status, payload_json
       FROM event_records
       ORDER BY event_id`)
        .all();
    const inventory = database
        .prepare(`SELECT
        batch_id, last_event_id, last_changed_at, quantity_status,
        seal_status, expiry_status, effective_status, payload_json
       FROM inventory_batch_projections
       ORDER BY batch_id`)
        .all();
    const issues = database
        .prepare(`SELECT issue_id, issue_code, status, revision, resolved_at, payload_json
       FROM issues
       ORDER BY issue_id`)
        .all();
    return `repository-v1:${canonicalSha256({
        authority_kind: "diet-manager/repository-revision/v1",
        events,
        inventory,
        issues,
    })}`;
}
