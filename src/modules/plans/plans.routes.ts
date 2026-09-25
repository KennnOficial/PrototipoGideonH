import type { FastifyInstance } from "fastify";

import { listVisiblePlans } from "./plans.service.js";

export async function registerPlanRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    const plans = await listVisiblePlans();

    return {
      items: plans,
      total: plans.length,
    };
  });
}
