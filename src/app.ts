import cors from "@fastify/cors";
import Fastify from "fastify";

import { env } from "./config/env.js";
import { registerRoutes } from "./routes.js";

export function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV !== "production",
  });

  void app.register(cors, {
    origin: [env.APP_URL],
    credentials: true,
  });

  void registerRoutes(app);

  app.setErrorHandler((error, _request, reply) => {
    const fastifyError = error as { statusCode?: number };
    const statusCode =
      typeof fastifyError.statusCode === "number" && fastifyError.statusCode >= 400
        ? fastifyError.statusCode
        : 500;
    const message = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
    const name = error instanceof Error ? error.name : "Error";

    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal Server Error" : name,
      message,
    });
  });

  return app;
}
