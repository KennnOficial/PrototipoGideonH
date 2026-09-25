import type { FastifyInstance } from "fastify";

import { registerCustomerRoutes } from "./modules/customers/customers.routes.js";
import { registerHealthRoutes } from "./modules/health/health.routes.js";
import { registerOrderRoutes } from "./modules/orders/orders.routes.js";
import {
  registerPaymentRoutes,
  registerStripeWebhookRoutes,
} from "./modules/payments/payments.routes.js";
import { registerPterodactylRoutes } from "./modules/pterodactyl/pterodactyl.routes.js";
import { registerPlanRoutes } from "./modules/plans/plans.routes.js";

export async function registerRoutes(app: FastifyInstance) {
  await app.register(registerHealthRoutes);
  await app.register(registerStripeWebhookRoutes, { prefix: "/api/webhooks" });
  await app.register(registerPterodactylRoutes, { prefix: "/api/internal/provisioning" });
  await app.register(registerPlanRoutes, { prefix: "/api/plans" });
  await app.register(registerCustomerRoutes, { prefix: "/api/customers" });
  await app.register(registerOrderRoutes, { prefix: "/api/orders" });
  await app.register(registerPaymentRoutes, { prefix: "/api/payments" });
}
