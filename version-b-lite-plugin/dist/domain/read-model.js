import { listMealProjection, listInventoryProjection, summarizeDailyProgress, } from "../repository/query.js";
export function queryDomainReadModel(database, operation) {
    if (operation.kind === "query_inventory") {
        return Object.freeze({
            kind: "inventory",
            batches: listInventoryProjection({ database }),
        });
    }
    if (operation.kind === "query_meals") {
        return Object.freeze({
            kind: "meals",
            date: operation.date,
            timezone: operation.timezone,
            meals: listMealProjection({
                database,
                date: operation.date,
                timezone: operation.timezone,
            }),
        });
    }
    const summary = summarizeDailyProgress({
        database,
        date: operation.date,
        timezone: operation.timezone,
    });
    return Object.freeze({
        kind: "daily_summary",
        date: operation.date,
        timezone: operation.timezone,
        coverage_status: summary.coverage_status,
        nutrients: summary.nutrients,
    });
}
