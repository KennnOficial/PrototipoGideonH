import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  PTERODACTYL_URL: z.string().url().optional(),
  PTERODACTYL_API_KEY: z.string().optional(),
  PTERODACTYL_CLIENT_URL: z.string().url().optional(),
  PTERODACTYL_DEFAULT_NEST_ID: z.coerce.number().int().positive().optional(),
  PTERODACTYL_DEFAULT_EGG_ID: z.coerce.number().int().positive().optional(),
  PTERODACTYL_DEFAULT_SERVER_IMAGE: z.string().optional(),
  PTERODACTYL_DEFAULT_STARTUP_COMMAND: z.string().optional(),
  PTERODACTYL_DEFAULT_ENVIRONMENT_JSON: z.string().optional(),
  PTERODACTYL_DEFAULT_ALLOCATION_ID: z.coerce.number().int().positive().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MAIL_FROM: z.string().email().optional(),
  MAIL_PROVIDER: z.string().optional(),
  MAIL_API_KEY: z.string().optional(),
  ADMIN_JOB_SECRET: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variables de entorno inválidas:", parsed.error.flatten().fieldErrors);
  throw new Error("No se pudo iniciar la API por configuración inválida.");
}

export const env = parsed.data;
