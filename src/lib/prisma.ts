import { PrismaClient } from "@prisma/client";

declare global {
  var __gideonPrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__gideonPrisma__ ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__gideonPrisma__ = prisma;
}
