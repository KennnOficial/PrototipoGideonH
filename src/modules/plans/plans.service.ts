import { prisma } from "../../lib/prisma.js";

export async function listVisiblePlans() {
  return prisma.plan.findMany({
    where: {
      isVisible: true,
      product: {
        is: {
          status: "ACTIVE",
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      tier: true,
      isPopular: true,
      priceMonthly: true,
      ramLabel: true,
      cpu: true,
      storageGb: true,
      backups: true,
      extraBackupSlots: true,
      extraBackupPrice: true,
      ports: true,
      databases: true,
      dedicatedIpPrice: true,
      locations: true,
      antiDdosIncluded: true,
    },
  });
}
