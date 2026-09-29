import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  evaluateRefund,
  type OrderFacts,
  type PolicyInput,
} from "../src/rules/refundPolicy.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-06-15T12:00:00Z");
const deliveredAgo = (ms: number) => new Date(NOW.getTime() - ms);

const baseOrder = (over: Partial<OrderFacts> = {}): OrderFacts => ({
  customerId: 1,
  amountCents: 12_900,
  status: "DELIVERED",
  refundStatus: "NONE",
  deliveredAt: deliveredAgo(5 * DAY),
  isFinalSale: false,
  ...over,
});

const input = (over: Partial<PolicyInput> = {}, order: Partial<OrderFacts> | null = {}): PolicyInput => ({
  order: order === null ? null : baseOrder(order),
  request: { customerId: 1, requestedAmountCents: 12_900 },
  priorRefundCount: 0,
  now: NOW,
  ...over,
});

describe("evaluateRefund", () => {
  describe("valid refunds", () => {
    it("approves a delivered, in-window, refundable order", () => {
      const r = evaluateRefund(input());
      expect(r.decision).toBe("APPROVED");
      expect(r.ruleCode).toBe("WITHIN_POLICY");
      expect(r.approvedAmountCents).toBe(12_900);
    });

    it("approves a partial refund for the requested amount", () => {
      const r = evaluateRefund(input({ request: { customerId: 1, requestedAmountCents: 5_000 } }));
      expect(r.decision).toBe("APPROVED");
      expect(r.approvedAmountCents).toBe(5_000);
    });
  });

  describe("invalid orders", () => {
    it("denies when the order does not exist", () => {
      const r = evaluateRefund(input({}, null));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "ORDER_NOT_FOUND" });
    });

    it("denies when the order belongs to another customer", () => {
      const r = evaluateRefund(input({ request: { customerId: 2, requestedAmountCents: 12_900 } }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "ORDER_NOT_OWNED" });
    });

    it.each([
      ["CANCELLED", "ORDER_CANCELLED"],
      ["SHIPPED", "ORDER_NOT_DELIVERED"],
      ["PROCESSING", "ORDER_NOT_DELIVERED"],
    ] as const)("denies a %s order", (status, ruleCode) => {
      const r = evaluateRefund(input({}, { status, deliveredAt: null }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode });
    });

    it("denies final-sale products", () => {
      const r = evaluateRefund(input({}, { isFinalSale: true }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "FINAL_SALE" });
    });
  });

  describe("already refunded", () => {
    it("denies an order that was already refunded", () => {
      const r = evaluateRefund(input({}, { refundStatus: "REFUNDED" }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "ALREADY_REFUNDED" });
    });

    it("denies a duplicate while a refund is pending", () => {
      const r = evaluateRefund(input({}, { refundStatus: "PENDING" }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "REFUND_PENDING" });
    });
  });

  describe("refund amounts", () => {
    it.each([0, -100, 10.5, Number.NaN])("denies invalid amount %s", (amount) => {
      const r = evaluateRefund(input({ request: { customerId: 1, requestedAmountCents: amount } }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "INVALID_AMOUNT" });
    });

    it("denies an amount above the order total", () => {
      const r = evaluateRefund(input({ request: { customerId: 1, requestedAmountCents: 12_901 } }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "AMOUNT_EXCEEDS_ORDER" });
    });

    it("approves exactly the auto-approve limit", () => {
      const limit = DEFAULT_POLICY.autoApproveLimitCents;
      const r = evaluateRefund(
        input({ request: { customerId: 1, requestedAmountCents: limit } }, { amountCents: 89_900 }),
      );
      expect(r.decision).toBe("APPROVED");
    });

    it("escalates one cent above the auto-approve limit", () => {
      const limit = DEFAULT_POLICY.autoApproveLimitCents;
      const r = evaluateRefund(
        input({ request: { customerId: 1, requestedAmountCents: limit + 1 } }, { amountCents: 89_900 }),
      );
      expect(r).toMatchObject({ decision: "ESCALATED", ruleCode: "HIGH_VALUE" });
    });

    it("approves a small partial refund on an expensive order", () => {
      const r = evaluateRefund(
        input({ request: { customerId: 1, requestedAmountCents: 10_000 } }, { amountCents: 89_900 }),
      );
      expect(r.decision).toBe("APPROVED");
    });
  });

  describe("refund window edges", () => {
    it("approves on the final day (30 days exactly)", () => {
      const r = evaluateRefund(input({}, { deliveredAt: deliveredAgo(30 * DAY) }));
      expect(r.decision).toBe("APPROVED");
    });

    it("denies one millisecond past 30 days", () => {
      const r = evaluateRefund(input({}, { deliveredAt: deliveredAgo(30 * DAY + 1) }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "OUTSIDE_WINDOW" });
    });

    it("approves when delivered a moment ago", () => {
      const r = evaluateRefund(input({}, { deliveredAt: deliveredAgo(0) }));
      expect(r.decision).toBe("APPROVED");
    });

    it("denies well outside the window", () => {
      const r = evaluateRefund(input({}, { deliveredAt: deliveredAgo(75 * DAY) }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "OUTSIDE_WINDOW" });
    });

    it("escalates a delivered order with no delivery date", () => {
      const r = evaluateRefund(input({}, { deliveredAt: null }));
      expect(r).toMatchObject({ decision: "ESCALATED", ruleCode: "DELIVERY_DATA_INVALID" });
    });

    it("escalates a delivery date in the future", () => {
      const r = evaluateRefund(input({}, { deliveredAt: new Date(NOW.getTime() + HOUR) }));
      expect(r).toMatchObject({ decision: "ESCALATED", ruleCode: "DELIVERY_DATA_INVALID" });
    });

    it("respects a custom window config", () => {
      const cfg = { ...DEFAULT_POLICY, windowDays: 7 };
      const r = evaluateRefund(input({}, { deliveredAt: deliveredAgo(8 * DAY) }), cfg);
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "OUTSIDE_WINDOW" });
    });
  });

  describe("escalation", () => {
    it("escalates a suspicious request that is otherwise eligible", () => {
      const r = evaluateRefund(input({ flags: { suspicious: true } }));
      expect(r).toMatchObject({ decision: "ESCALATED", ruleCode: "SUSPICIOUS_REQUEST" });
      expect(r.approvedAmountCents).toBeUndefined();
    });

    it("escalates an ambiguous request", () => {
      const r = evaluateRefund(input({ flags: { ambiguous: true } }));
      expect(r).toMatchObject({ decision: "ESCALATED", ruleCode: "SUSPICIOUS_REQUEST" });
    });

    it("escalates repeat refunders at the threshold", () => {
      const r = evaluateRefund(input({ priorRefundCount: DEFAULT_POLICY.repeatRefundThreshold }));
      expect(r).toMatchObject({ decision: "ESCALATED", ruleCode: "REPEAT_REFUNDS" });
    });

    it("approves just below the repeat-refund threshold", () => {
      const r = evaluateRefund(input({ priorRefundCount: DEFAULT_POLICY.repeatRefundThreshold - 1 }));
      expect(r.decision).toBe("APPROVED");
    });
  });

  describe("rules cannot be overridden by signals", () => {
    it("a clean flag set never turns a denial into an approval", () => {
      const r = evaluateRefund(
        input({ flags: { suspicious: false, ambiguous: false } }, { deliveredAt: deliveredAgo(60 * DAY) }),
      );
      expect(r.decision).toBe("DENIED");
    });

    it("suspicion does not soften a hard denial into an escalation", () => {
      const r = evaluateRefund(input({ flags: { suspicious: true } }, { refundStatus: "REFUNDED" }));
      expect(r).toMatchObject({ decision: "DENIED", ruleCode: "ALREADY_REFUNDED" });
    });
  });

  it("is deterministic for identical input", () => {
    const i = input();
    expect(evaluateRefund(i)).toEqual(evaluateRefund(i));
  });
});
