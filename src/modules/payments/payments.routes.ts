import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createStripeCheckoutSession, handleStripeWebhook } from "./payments.service.js";

const checkoutSchema = z.object({
  orderId: z.string().cuid(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export async function registerPaymentRoutes(app: FastifyInstance) {
  app.post("/stripe/checkout-session", async (request, reply) => {
    const payload = checkoutSchema.parse(request.body);
    const session = await createStripeCheckoutSession(payload);

    reply.status(201).send(session);
  });
}

export async function registerStripeWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.post("/stripe", async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body || {});
    const result = await handleStripeWebhook(rawBody, Array.isArray(signature) ? signature[0] : signature);

    reply.send(result);
  });
}
