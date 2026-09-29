import {
  OrderStatus,
  PrismaClient,
  ProductCategory,
  RefundDecision,
  RefundStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/*
 * Target policy the rules engine will implement (kept here so the scenarios below are readable):
 *   DENIED    - final-sale product, already refunded, cancelled, not yet delivered,
 *               or delivered more than 30 days ago
 *   ESCALATED - order amount over $500, or customer already has 3+ refunded orders
 *   APPROVED  - everything else: delivered within 30 days, refundable, under the amount limit
 */

const products = [
  { sku: "EL-HP-100", name: "Aurora Wireless Headphones", category: ProductCategory.ELECTRONICS, priceCents: 12900 },
  { sku: "EL-LT-900", name: "Nimbus 14\" Laptop", category: ProductCategory.ELECTRONICS, priceCents: 89900 },
  { sku: "EL-WT-200", name: "Pulse Smartwatch", category: ProductCategory.ELECTRONICS, priceCents: 24900 },
  { sku: "AP-JK-310", name: "Trailhead Rain Jacket", category: ProductCategory.APPAREL, priceCents: 8900 },
  { sku: "AP-SH-415", name: "Stride Running Shoes", category: ProductCategory.APPAREL, priceCents: 11000 },
  { sku: "HM-CF-500", name: "Brewmaster Coffee Machine", category: ProductCategory.HOME, priceCents: 15900 },
  { sku: "HM-VC-610", name: "Whirl Robot Vacuum", category: ProductCategory.HOME, priceCents: 34900 },
  { sku: "DG-ED-700", name: "Photo Editor Pro (1-year license)", category: ProductCategory.DIGITAL, priceCents: 5900 },
  { sku: "PC-SR-820", name: "Glow Skincare Set (opened-only clearance)", category: ProductCategory.PERSONAL_CARE, priceCents: 4500, isFinalSale: true },
  { sku: "AP-CL-999", name: "Clearance Wool Coat", category: ProductCategory.APPAREL, priceCents: 7900, isFinalSale: true },
] as const;

const customers = [
  { name: "Amelia Hart", email: "amelia.hart@example.com", phone: "+1-415-555-0111", country: "US" },
  { name: "Benjamin Okafor", email: "ben.okafor@example.com", phone: "+1-212-555-0142", country: "US" },
  { name: "Chloe Martin", email: "chloe.martin@example.com", phone: "+44-20-7946-0123", country: "GB" },
  { name: "Daniel Nguyen", email: "daniel.nguyen@example.com", phone: "+1-206-555-0177", country: "US" },
  { name: "Elena Petrova", email: "elena.petrova@example.com", phone: null, country: "DE" },
  { name: "Farid Rahman", email: "farid.rahman@example.com", phone: "+1-312-555-0190", country: "US" },
  { name: "Grace Kimani", email: "grace.kimani@example.com", phone: "+254-20-555-0123", country: "KE" },
  { name: "Hiro Tanaka", email: "hiro.tanaka@example.com", phone: "+81-3-5555-0100", country: "JP" },
  { name: "Isabella Rossi", email: "isabella.rossi@example.com", phone: "+39-06-555-0166", country: "IT" },
  { name: "Jamal Wright", email: "jamal.wright@example.com", phone: "+1-404-555-0150", country: "US" },
  { name: "Katya Ivanova", email: "katya.ivanova@example.com", phone: null, country: "CA" },
  { name: "Liam O'Brien", email: "liam.obrien@example.com", phone: "+353-1-555-0188", country: "IE" },
  { name: "Maya Patel", email: "maya.patel@example.com", phone: "+1-617-555-0134", country: "US" },
  { name: "Noah Fischer", email: "noah.fischer@example.com", phone: "+49-30-555-0121", country: "DE" },
  { name: "Olivia Santos", email: "olivia.santos@example.com", phone: "+55-11-5555-0199", country: "BR" },
];

type OrderSeed = {
  customer: number; // index into customers
  sku: (typeof products)[number]["sku"];
  orderedDaysAgo: number;
  deliveredDaysAgo: number | null;
  status: OrderStatus;
  refundStatus?: RefundStatus;
  scenario: string;
  // Historical refund request to attach (dashboard sample data)
  history?: { decision: RefundDecision; ruleCode: string; reason: string; decisionReason: string };
};

const D = OrderStatus.DELIVERED;

const orderSeeds: OrderSeed[] = [
  // --- Expected APPROVED ---
  { customer: 0, sku: "EL-HP-100", orderedDaysAgo: 9, deliveredDaysAgo: 5, status: D, scenario: "approved: delivered 5d ago, defective headphones" },
  { customer: 1, sku: "AP-JK-310", orderedDaysAgo: 20, deliveredDaysAgo: 15, status: D, scenario: "approved: wrong size, 15d after delivery" },
  { customer: 2, sku: "HM-CF-500", orderedDaysAgo: 30, deliveredDaysAgo: 28, status: D, scenario: "approved: 28d, close to the 30d window edge" },
  { customer: 3, sku: "EL-WT-200", orderedDaysAgo: 4, deliveredDaysAgo: 1, status: D, scenario: "approved: delivered yesterday" },
  { customer: 4, sku: "AP-SH-415", orderedDaysAgo: 12, deliveredDaysAgo: 8, status: D, scenario: "approved: shoes did not fit" },

  // --- Expected DENIED ---
  { customer: 5, sku: "EL-HP-100", orderedDaysAgo: 75, deliveredDaysAgo: 70, status: D, scenario: "denied: outside 30d window" },
  { customer: 6, sku: "AP-CL-999", orderedDaysAgo: 10, deliveredDaysAgo: 6, status: D, scenario: "denied: final-sale item" },
  { customer: 7, sku: "PC-SR-820", orderedDaysAgo: 8, deliveredDaysAgo: 3, status: D, scenario: "denied: final-sale item" },
  {
    customer: 8, sku: "EL-WT-200", orderedDaysAgo: 25, deliveredDaysAgo: 20, status: D, refundStatus: RefundStatus.REFUNDED,
    scenario: "denied: already refunded (duplicate request)",
    history: { decision: RefundDecision.APPROVED, ruleCode: "WITHIN_WINDOW", reason: "Screen flickers", decisionReason: "Delivered within 30 days and eligible for a full refund." },
  },
  { customer: 9, sku: "HM-VC-610", orderedDaysAgo: 3, deliveredDaysAgo: null, status: OrderStatus.SHIPPED, scenario: "denied: not yet delivered" },
  { customer: 10, sku: "AP-SH-415", orderedDaysAgo: 6, deliveredDaysAgo: null, status: OrderStatus.CANCELLED, scenario: "denied: order was cancelled" },
  {
    customer: 5, sku: "DG-ED-700", orderedDaysAgo: 45, deliveredDaysAgo: 45, status: D,
    scenario: "denied: digital license, outside window",
    history: { decision: RefundDecision.DENIED, ruleCode: "OUTSIDE_WINDOW", reason: "Changed my mind", decisionReason: "Delivered 45 days ago, beyond the 30-day refund window." },
  },

  // --- Expected ESCALATED ---
  { customer: 11, sku: "EL-LT-900", orderedDaysAgo: 7, deliveredDaysAgo: 4, status: D, scenario: "escalated: $899 exceeds the $500 auto-approval limit" },
  { customer: 12, sku: "EL-LT-900", orderedDaysAgo: 14, deliveredDaysAgo: 10, status: D, scenario: "escalated: $899 laptop, high value" },
  // Customer 13 already has 3 refunded orders (below) -> a fourth request is escalated for review
  { customer: 13, sku: "AP-JK-310", orderedDaysAgo: 60, deliveredDaysAgo: 56, status: D, refundStatus: RefundStatus.REFUNDED, scenario: "history: refunded",
    history: { decision: RefundDecision.APPROVED, ruleCode: "WITHIN_WINDOW", reason: "Zipper broke", decisionReason: "Delivered within 30 days and eligible for a full refund." } },
  { customer: 13, sku: "AP-SH-415", orderedDaysAgo: 40, deliveredDaysAgo: 36, status: D, refundStatus: RefundStatus.REFUNDED, scenario: "history: refunded",
    history: { decision: RefundDecision.APPROVED, ruleCode: "WITHIN_WINDOW", reason: "Wrong colour", decisionReason: "Delivered within 30 days and eligible for a full refund." } },
  { customer: 13, sku: "HM-CF-500", orderedDaysAgo: 22, deliveredDaysAgo: 18, status: D, refundStatus: RefundStatus.REFUNDED, scenario: "history: refunded",
    history: { decision: RefundDecision.APPROVED, ruleCode: "WITHIN_WINDOW", reason: "Leaks", decisionReason: "Delivered within 30 days and eligible for a full refund." } },
  { customer: 13, sku: "EL-HP-100", orderedDaysAgo: 8, deliveredDaysAgo: 4, status: D, scenario: "escalated: 4th refund candidate, repeat-refund pattern" },

  // --- Extra variety ---
  { customer: 14, sku: "HM-VC-610", orderedDaysAgo: 2, deliveredDaysAgo: null, status: OrderStatus.PROCESSING, scenario: "denied: still processing (not delivered)" },
  { customer: 14, sku: "DG-ED-700", orderedDaysAgo: 5, deliveredDaysAgo: 5, status: D, scenario: "approved: digital license within window" },
  {
    customer: 3, sku: "HM-VC-610", orderedDaysAgo: 18, deliveredDaysAgo: 14, status: D, refundStatus: RefundStatus.PENDING,
    scenario: "pending escalation awaiting human review",
    history: { decision: RefundDecision.ESCALATED, ruleCode: "REVIEW_REQUIRED", reason: "Vacuum stopped charging", decisionReason: "Flagged for manual review by a support agent." },
  },
];

async function main() {
  // Idempotent: wipe in FK-safe order, then re-create.
  await prisma.supportMessage.deleteMany();
  await prisma.supportConversation.deleteMany();
  await prisma.refundRequest.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();

  const productBySku = new Map<string, { id: number; priceCents: number }>();
  for (const p of products) {
    const row = await prisma.product.create({ data: { ...p } });
    productBySku.set(p.sku, row);
  }

  const customerRows = [];
  for (const c of customers) {
    customerRows.push(await prisma.customer.create({ data: { ...c, createdAt: daysAgo(200) } }));
  }

  let n = 1000;
  for (const seed of orderSeeds) {
    const customer = customerRows[seed.customer]!;
    const product = productBySku.get(seed.sku)!;
    const order = await prisma.order.create({
      data: {
        orderNumber: `WN-${++n}`,
        customerId: customer.id,
        productId: product.id,
        amountCents: product.priceCents,
        status: seed.status,
        refundStatus: seed.refundStatus ?? RefundStatus.NONE,
        orderedAt: daysAgo(seed.orderedDaysAgo),
        deliveredAt: seed.deliveredDaysAgo === null ? null : daysAgo(seed.deliveredDaysAgo),
      },
    });
    if (seed.history) {
      await prisma.refundRequest.create({
        data: {
          customerId: customer.id,
          orderId: order.id,
          reason: seed.history.reason,
          requestedAmountCents: order.amountCents,
          decision: seed.history.decision,
          ruleCode: seed.history.ruleCode,
          decisionReason: seed.history.decisionReason,
        },
      });
    }
  }

  console.log(
    `Seeded ${customerRows.length} customers, ${products.length} products, ${orderSeeds.length} orders.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
