import type { Prisma } from "@prisma/client";
import Stripe from "stripe";

import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";

let stripeClient: Stripe | null = null;

function getStripeClient() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe no está configurado todavía.");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }

  return stripeClient;
}

function decimalToCents(value: string | number) {
  return Math.round(Number(value) * 100);
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export async function createStripeCheckoutSession(input: {
  orderId: string;
  successUrl?: string;
  cancelUrl?: string;
}) {
  const stripe = getStripeClient();

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: {
      items: true,
      user: {
        include: {
          customerProfile: true,
        },
      },
      payments: true,
    },
  });

  if (!order) {
    throw new Error("La orden no existe.");
  }

  if (order.status !== "PENDING") {
    throw new Error("La orden ya no está disponible para checkout.");
  }

  const existingOpenPayment = order.payments.find(
    (payment) =>
      payment.provider === "STRIPE" &&
      payment.status === "PENDING" &&
      payment.providerSessionId,
  );

  if (existingOpenPayment?.providerSessionId) {
    const existingSession = await stripe.checkout.sessions.retrieve(existingOpenPayment.providerSessionId);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      sessionId: existingSession.id,
      url: existingSession.url,
    };
  }

  const successUrl =
    input.successUrl?.trim() || `${env.APP_URL}/store.html?checkout=success&order_id=${order.id}`;
  const cancelUrl =
    input.cancelUrl?.trim() || `${env.APP_URL}/store.html?checkout=cancelled&order_id=${order.id}`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: order.user.email,
    client_reference_id: order.id,
    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
    },
    line_items: order.items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: order.currency.toLowerCase(),
        unit_amount: decimalToCents(item.unitPrice.toString()),
        product_data: {
          name: item.planNameSnapshot,
          description: `${item.ramLabelSnapshot} · ${item.cpuSnapshot} · ${item.locationsSnapshot.join(" / ")}`,
          metadata: {
            planSlug: item.planSlugSnapshot,
            orderItemId: item.id,
          },
        },
      },
    })),
    payment_intent_data: {
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
      },
      receipt_email: order.user.email,
    },
  });

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: "STRIPE",
      status: "PENDING",
      amount: order.total,
      currency: order.currency,
      providerSessionId: session.id,
      rawPayload: toJsonValue(session) as Prisma.InputJsonValue,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: order.userId,
      action: "payment.checkout_session.created",
      entityType: "order",
      entityId: order.id,
      meta: {
        sessionId: session.id,
        provider: "stripe",
      },
    },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    sessionId: session.id,
    url: session.url,
  };
}

async function ensureProvisioningJobsForPaidOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      provisioningJobs: true,
    },
  });

  if (!order) return;

  for (const item of order.items) {
    const existing = order.provisioningJobs.find((job) => {
      if (job.jobType !== "PTERODACTYL_CREATE_SERVER") return false;
      const payload = job.payload as { orderItemId?: string } | null;
      return payload?.orderItemId === item.id;
    });

    if (existing) continue;

    await prisma.provisioningJob.create({
      data: {
        orderId,
        jobType: "PTERODACTYL_CREATE_SERVER",
        status: "PENDING",
        payload: {
          orderItemId: item.id,
          planSlug: item.planSlugSnapshot,
          quantity: item.quantity,
        },
      },
    });
  }
}

export async function handleStripeWebhook(rawBody: string, signature?: string) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Stripe webhook secret no configurado.");
  }

  const stripe = getStripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature || "", env.STRIPE_WEBHOOK_SECRET);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId || session.client_reference_id;

    if (!orderId) {
      return { received: true, ignored: true, reason: "missing_order_id" };
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
      },
    });

    if (!order) {
      return { received: true, ignored: true, reason: "order_not_found" };
    }

    const existingPayment = order.payments.find(
      (payment) => payment.provider === "STRIPE" && payment.providerSessionId === session.id,
    );

    await prisma.payment.upsert({
      where: {
        providerSessionId: session.id,
      },
      update: {
        status: "SUCCEEDED",
        providerPaymentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
        receiptUrl: session.url || null,
        rawPayload: toJsonValue(session) as Prisma.InputJsonValue,
        paidAt: new Date(),
      },
      create: {
        orderId: order.id,
        provider: "STRIPE",
        status: "SUCCEEDED",
        amount: order.total,
        currency: order.currency,
        providerSessionId: session.id,
        providerPaymentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
        receiptUrl: session.url || null,
        rawPayload: toJsonValue(session) as Prisma.InputJsonValue,
        paidAt: new Date(),
      },
    });

    if (order.status === "PENDING") {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
        },
      });

      await ensureProvisioningJobsForPaidOrder(order.id);

      await prisma.auditLog.create({
        data: {
          userId: order.userId,
          action: "payment.completed",
          entityType: "order",
          entityId: order.id,
          meta: {
            provider: "stripe",
            sessionId: session.id,
            existingPaymentId: existingPayment?.id ?? null,
          },
        },
      });
    }
  }

  return { received: true };
}
