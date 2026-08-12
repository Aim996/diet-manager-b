import { listInventoryProjection, } from "../repository/query.js";
export function queryDomainReadModel(database, operation) {
    if (operation.kind !== "query_inventory") {
        throw new Error(`DOMAIN_QUERY_NOT_IMPLEMENTED:${operation.kind}`);
    }
    return Object.freeze({
        kind: "inventory",
        batches: listInventoryProjection({ database }),
    });
}
