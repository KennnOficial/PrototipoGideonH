import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { upsertCustomer } from "./customers.service.js";

const customerSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(120).optional(),
  discordTag: z.string().min(2).max(80).optional(),
});

export async function registerCustomerRoutes(app: FastifyInstance) {
  app.post("/", async (request, reply) => {
    const payload = customerSchema.parse(request.body);
    const customer = await upsertCustomer(payload);

    reply.status(201).send({
      id: customer.id,
      email: customer.email,
      profile: customer.customerProfile,
    });
  });
}
