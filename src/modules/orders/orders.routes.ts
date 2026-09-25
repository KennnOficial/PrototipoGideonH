import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createPendingOrder, findOrderById } from "./orders.service.js";

const createOrderSchema = z.object({
  customer: z.object({
    email: z.string().email(),
    fullName: z.string().min(2).max(120).optional(),
    discordTag: z.string().min(2).max(80).optional(),
  }),
  items: z
    .array(
      z.object({
        planSlug: z.string().min(2),
        quantity: z.coerce.number().int().min(1).max(10).default(1),
      }),
    )
    .min(1),
  notes: z.string().max(500).optional(),
});

export async function registerOrderRoutes(app: FastifyInstance) {
  app.post("/", async (request, reply) => {
    const payload = createOrderSchema.parse(request.body);
    const order = await createPendingOrder(payload);

    reply.status(201).send(order);
  });

  app.get("/:id", async (request, reply) => {
    const params = z.object({ id: z.string().cuid() }).parse(request.params);
    const order = await findOrderById(params.id);

    if (!order) {
      reply.status(404).send({
        error: "Not Found",
        message: "La orden no existe.",
      });
      return;
    }

    reply.send(order);
  });
}
