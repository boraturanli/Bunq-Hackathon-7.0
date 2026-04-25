import type { Receipt } from "@/lib/types/receipt";
import type { ItemClaim } from "./store";

/**
 * Compute what an invitee owes, given their item claims.
 * Each claimed item contributes line_total / sharedWith.
 * Tax + tip are distributed proportionally to claimed food share.
 */
export function computeAmountOwed(receipt: Receipt, claims: ItemClaim[]): number {
  const subtotal = receipt.items.reduce((s, i) => s + i.line_total, 0);
  let food = 0;
  for (const claim of claims) {
    const item = receipt.items.find((i) => i.id === claim.itemId);
    if (!item) continue;
    const share = Math.max(1, claim.sharedWith);
    food += item.line_total / share;
  }
  const extras = subtotal > 0 ? (food / subtotal) * (receipt.tax + receipt.tip) : 0;
  return Math.round((food + extras) * 100) / 100;
}
