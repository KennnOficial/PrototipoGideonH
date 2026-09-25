import { Decimal } from "@prisma/client/runtime/library";

import { prisma } from "../../lib/prisma.js";
import { upsertCustomer } from "../customers/customers.service.js";

type OrderItemInput = {
  planSlug: string;
  quantity: number;
};

type CreatePendingOrderInput = {
  customer: {
    email: string;
    fullName?: string;
    discordTag?: string;
  };
  items: OrderItemInput[];
  notes?: string;
};

function buildOrderNumber() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `GH-${Date.now()}-${random}`;
}

export async function createPendingOrder(input: CreatePendingOrderInput) {
  if (!input.items.length) {
    throw new Error("La orden requiere al menos un plan.");
  }

  const customer = await upsertCustomer(input.customer);
  const quantities = new Map<string, number>();

  for (const item of input.items) {
    quantities.set(item.planSlug, (quantities.get(item.planSlug) ?? 0) + item.quantity);
  }

  const plans = await prisma.plan.findMany({
    where: {
      slug: {
        in: [...quantities.keys()],
      },
      isVisible: true,
    },
    orderBy: {
      sortOrder: "asc",
    },
  });

  if (plans.length !== quantities.size) {
    throw new Error("Uno o más planes ya no están disponibles.");
  }

  const items = plans.map((plan) => {
    const quantity = quantities.get(plan.slug) ?? 1;
    const unitPrice = new Decimal(plan.priceMonthly);
    const totalPrice = unitPrice.mul(quantity);

    return {
      planId: plan.id,
      quantity,
      unitPrice,
      totalPrice,
      planNameSnapshot: plan.name,
      planSlugSnapshot: plan.slug,
      ramLabelSnapshot: plan.ramLabel,
      cpuSnapshot: plan.cpu,
      storageGbSnapshot: plan.storageGb,
      backupsSnapshot: plan.backups,
      portsSnapshot: plan.ports,
      databasesSnapshot: plan.databases,
      locationsSnapshot: plan.locations,
    };
  });

  const subtotal = items.reduce((sum, item) => sum.add(item.totalPrice), new Decimal(0));

  const order = await prisma.order.create({
    data: {
      orderNumber: buildOrderNumber(),
      userId: customer.id,
      status: "PENDING",
      currency: customer.customerProfile?.currency ?? "USD",
      subtotal,
      discountTotal: new Decimal(0),
      taxTotal: new Decimal(0),
      total: subtotal,
      notes: input.notes?.trim() || null,
      items: {
        create: items,
      },
    },
    include: {
      items: true,
      user: {
        include: {
          customerProfile: true,
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: customer.id,
      action: "order.created",
      entityType: "order",
      entityId: order.id,
      meta: {
        orderNumber: order.orderNumber,
        total: order.total.toString(),
      },
    },
  });

  return order;
}

export async function findOrderById(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          plan: true,
        },
      },
      payments: true,
      user: {
        include: {
          customerProfile: true,
        },
      },
    },
  });
}
