import type { DietManagerOutcome } from "../contracts.js";
import {
  buildReceiptRenderModel,
  type ReceiptRenderModel,
} from "../domain/receipt-render-model.js";

export interface PublicReceiptAdapterResult {
  readonly content: Readonly<{ readonly type: "text"; readonly text: string }>[];
  readonly details: DietManagerOutcome;
  readonly render_model: ReceiptRenderModel;
}

export function buildPublicAdapterResult(outcome: DietManagerOutcome): PublicReceiptAdapterResult {
  const renderModel = buildReceiptRenderModel(outcome);
  const content: Readonly<{ readonly type: "text"; readonly text: string }>[] = [
    Object.freeze({ type: "text" as const, text: renderModel.text }),
  ];
  Object.freeze(content);
  return Object.freeze({
    content,
    details: outcome,
    render_model: renderModel,
  });
}
