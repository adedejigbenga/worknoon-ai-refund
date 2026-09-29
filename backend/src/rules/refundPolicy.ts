/**
 * Deterministic refund policy engine.
 *
 * Pure function: no database, network, clock or LLM access. `now` is an input, so every
 * outcome is reproducible. This module is the only authority on refund decisions; AI-derived
 * signals can only push a request toward human review (ESCALATED), never toward approval.
 */

export type RefundDecision = "APPROVED" | "DENIED" | "ESCALATED";
export type OrderStatus = "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED";
export type RefundStatus = "NONE" | "PENDING" | "REFUNDED";

export type RuleCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_OWNED"
  | "INVALID_AMOUNT"
  | "ALREADY_REFUNDED"
  | "REFUND_PENDING"
  | "ORDER_CANCELLED"
  | "ORDER_NOT_DELIVERED"
  | "FINAL_SALE"
  | "AMOUNT_EXCEEDS_ORDER"
  | "OUTSIDE_WINDOW"
  | "DELIVERY_DATA_INVALID"
  | "SUSPICIOUS_REQUEST"
  | "HIGH_VALUE"
  | "REPEAT_REFUNDS"
  | "WITHIN_POLICY";

export interface PolicyConfig {
  /** Days after delivery during which a refund may be requested (inclusive). */
  windowDays: number;
  /** Requested amounts above this always need a human (cents). */
  autoApproveLimitCents: number;
  /** Customers with at least this many previously refunded orders need a human. */
  repeatRefundThreshold: number;
}

export const DEFAULT_POLICY: Readonly<PolicyConfig> = Object.freeze({
  windowDays: 30,
  autoApproveLimitCents: 50_000,
  repeatRefundThreshold: 3,
});

export interface OrderFacts {
  customerId: number;
  amountCents: number;
  status: OrderStatus;
  refundStatus: RefundStatus;
  deliveredAt: Date | null;
  isFinalSale: boolean;
}

export interface RefundRequestFacts {
  customerId: number;
  requestedAmountCents: number;
}

/** Signals that can only trigger escalation. Set by the caller, e.g. from injection detection. */
export interface ReviewFlags {
  suspicious?: boolean;
  ambiguous?: boolean;
}

export interface PolicyInput {
  /** null when the order lookup found nothing. */
  order: OrderFacts | null;
  request: RefundRequestFacts;
  /** Number of this customer's orders already refunded. */
  priorRefundCount: number;
  flags?: ReviewFlags;
  now: Date;
}

export interface PolicyResult {
  decision: RefundDecision;
  ruleCode: RuleCode;
  reason: string;
  /** Present only when APPROVED. */
  approvedAmountCents?: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const result = (
  decision: RefundDecision,
  ruleCode: RuleCode,
  reason: string,
  approvedAmountCents?: number,
): PolicyResult =>
  approvedAmountCents === undefined
    ? { decision, ruleCode, reason }
    : { decision, ruleCode, reason, approvedAmountCents };

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function evaluateRefund(
  input: PolicyInput,
  config: PolicyConfig = DEFAULT_POLICY,
): PolicyResult {
  const { order, request, priorRefundCount, flags, now } = input;

  // --- Hard denials: facts that make the request ineligible regardless of anything else ---
  if (!order) {
    return result("DENIED", "ORDER_NOT_FOUND", "The order could not be found.");
  }
  if (order.customerId !== request.customerId) {
    // Same wording as not-found from the customer's point of view is the caller's concern;
    // internally we keep a distinct code for auditing.
    return result("DENIED", "ORDER_NOT_OWNED", "The order does not belong to this customer.");
  }
  if (!Number.isInteger(request.requestedAmountCents) || request.requestedAmountCents <= 0) {
    return result("DENIED", "INVALID_AMOUNT", "The requested refund amount is not valid.");
  }
  if (order.refundStatus === "REFUNDED") {
    return result("DENIED", "ALREADY_REFUNDED", "This order has already been refunded.");
  }
  if (order.refundStatus === "PENDING") {
    return result("DENIED", "REFUND_PENDING", "A refund for this order is already under review.");
  }
  if (order.status === "CANCELLED") {
    return result("DENIED", "ORDER_CANCELLED", "The order was cancelled, so there is nothing to refund.");
  }
  if (order.status !== "DELIVERED") {
    return result("DENIED", "ORDER_NOT_DELIVERED", "The order has not been delivered yet.");
  }
  if (order.isFinalSale) {
    return result("DENIED", "FINAL_SALE", "Final-sale items are not eligible for refunds.");
  }
  if (request.requestedAmountCents > order.amountCents) {
    return result(
      "DENIED",
      "AMOUNT_EXCEEDS_ORDER",
      `The requested amount (${usd(request.requestedAmountCents)}) exceeds the order total (${usd(order.amountCents)}).`,
    );
  }

  // A delivered order without a usable delivery date is inconsistent data: a human must look.
  if (!order.deliveredAt || order.deliveredAt.getTime() > now.getTime()) {
    return result(
      "ESCALATED",
      "DELIVERY_DATA_INVALID",
      "The delivery date for this order is missing or invalid and needs manual review.",
    );
  }

  const elapsedMs = now.getTime() - order.deliveredAt.getTime();
  if (elapsedMs > config.windowDays * DAY_MS) {
    return result(
      "DENIED",
      "OUTSIDE_WINDOW",
      `The ${config.windowDays}-day refund window after delivery has passed.`,
    );
  }

  // --- Eligible on the facts; now decide whether a human must confirm ---
  if (flags?.suspicious || flags?.ambiguous) {
    return result(
      "ESCALATED",
      "SUSPICIOUS_REQUEST",
      "The request needs manual review by a support agent.",
    );
  }
  if (request.requestedAmountCents > config.autoApproveLimitCents) {
    return result(
      "ESCALATED",
      "HIGH_VALUE",
      `Refunds above ${usd(config.autoApproveLimitCents)} require manual review.`,
    );
  }
  if (priorRefundCount >= config.repeatRefundThreshold) {
    return result(
      "ESCALATED",
      "REPEAT_REFUNDS",
      "This account has several recent refunds, so the request needs manual review.",
    );
  }

  return result(
    "APPROVED",
    "WITHIN_POLICY",
    `Delivered within ${config.windowDays} days and eligible for a refund of ${usd(request.requestedAmountCents)}.`,
    request.requestedAmountCents,
  );
}
