export function failedOutcome(action, operationId, errorCode) {
    return Object.freeze({
        action,
        status: "failed",
        committed: false,
        ...(operationId === undefined ? {} : { operation_id: operationId }),
        error_code: errorCode,
    });
}
export function nonWritingOutcome(action, operationId, status, reasonCode) {
    return Object.freeze({
        action,
        status,
        committed: false,
        operation_id: operationId,
        reason_code: reasonCode,
    });
}
export function committedOutcome(action, operationId, status, recordId) {
    return Object.freeze({
        action,
        status,
        committed: true,
        operation_id: operationId,
        record_id: recordId,
    });
}
