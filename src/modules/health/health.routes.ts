import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "gideon-hosting-backend",
      timestamp: new Date().toISOString(),
    };
  });
}
