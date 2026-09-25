import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import {
  processPendingProvisioningJobs,
  processProvisioningJob,
} from "./pterodactyl.service.js";

function assertInternalSecret(secretHeader?: string | string[]) {
  const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;

  if (!secret || secret !== env.ADMIN_JOB_SECRET) {
    const error = new Error("No autorizado para ejecutar jobs internos.");
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }
}

export async function registerPterodactylRoutes(app: FastifyInstance) {
  app.post("/run", async (request, reply) => {
    assertInternalSecret(request.headers["x-admin-job-secret"]);

    const body = z
      .object({
        jobId: z.string().cuid().optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .parse(request.body ?? {});

    if (body.jobId) {
      const result = await processProvisioningJob(body.jobId);
      reply.send(result);
      return;
    }

    const results = await processPendingProvisioningJobs(body.limit ?? 10);
    reply.send({
      processed: results.length,
      results,
    });
  });
}
