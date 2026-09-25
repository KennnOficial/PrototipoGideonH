import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import {
  createPterodactylServer,
  createPterodactylUser,
  findPterodactylUserByExternalId,
} from "./pterodactyl.client.js";

function splitName(fullName?: string | null) {
  const raw = (fullName || "").trim();
  if (!raw) {
    return { firstName: "Gideon", lastName: "Client" };
  }

  const parts = raw.split(/\s+/);
  return {
    firstName: parts[0] || "Gideon",
    lastName: parts.slice(1).join(" ") || "Client",
  };
}

function makePanelUsername(email: string) {
  const localPart = email.split("@")[0] || "gideon";
  return localPart.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 24) || "gideonuser";
}

async function resolveAllocationId(plan: {
  pterodactylAllocationHint: string | null;
}) {
  const directHint = Number(plan.pterodactylAllocationHint || env.PTERODACTYL_DEFAULT_ALLOCATION_ID);

  if (directHint) {
    return directHint;
  }

  throw new Error("Falta un allocation id manual de Pterodactyl para crear servidores.");
}

async function getPterodactylDefaults(plan: {
  pterodactylNestId: number | null;
  pterodactylEggId: number | null;
  pterodactylAllocationHint: string | null;
  ramMb: number;
  storageGb: number;
  databases: number;
  backups: number;
}) {
  const nestId = plan.pterodactylNestId ?? env.PTERODACTYL_DEFAULT_NEST_ID;
  const eggId = plan.pterodactylEggId ?? env.PTERODACTYL_DEFAULT_EGG_ID;
  const allocationId = await resolveAllocationId(plan);
  const dockerImage = env.PTERODACTYL_DEFAULT_SERVER_IMAGE;
  const startup = env.PTERODACTYL_DEFAULT_STARTUP_COMMAND;

  if (!nestId || !eggId || !allocationId || !dockerImage || !startup) {
    throw new Error("Falta configuración base de Pterodactyl para crear servidores.");
  }

  const environment = env.PTERODACTYL_DEFAULT_ENVIRONMENT_JSON
    ? (JSON.parse(env.PTERODACTYL_DEFAULT_ENVIRONMENT_JSON) as Record<string, string>)
    : {};

  return {
    nestId,
    eggId,
    allocationId,
    dockerImage,
    startup,
    environment,
    diskMb: plan.storageGb * 1024,
    ramMb: plan.ramMb,
    databases: plan.databases,
    backups: plan.backups,
  };
}

async function ensurePterodactylAccount(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      customerProfile: true,
      pterodactylAccount: true,
    },
  });

  if (!user) {
    throw new Error("No se encontró el usuario de la orden.");
  }

  if (user.pterodactylAccount?.pterodactylUserId) {
    return user.pterodactylAccount;
  }

  const externalId = user.pterodactylAccount?.externalId || `gideon-user-${user.id}`;
  const existing = await findPterodactylUserByExternalId(externalId);
  const names = splitName(user.customerProfile?.fullName);
  const panelUser =
    existing ||
    (await createPterodactylUser({
      externalId,
      email: user.email,
      username: makePanelUsername(user.email),
      firstName: names.firstName,
      lastName: names.lastName,
    }));

  return prisma.pterodactylAccount.upsert({
    where: { userId: user.id },
    update: {
      externalId,
      pterodactylUserId: panelUser.attributes.id,
      panelUsername: panelUser.attributes.username,
      panelEmail: panelUser.attributes.email,
    },
    create: {
      userId: user.id,
      externalId,
      pterodactylUserId: panelUser.attributes.id,
      panelUsername: panelUser.attributes.username,
      panelEmail: panelUser.attributes.email,
    },
  });
}

async function refreshOrderProvisioningState(orderId: string) {
  const jobs = await prisma.provisioningJob.findMany({
    where: { orderId },
    select: { status: true },
  });

  if (!jobs.length) return;

  const hasFailed = jobs.some((job) => job.status === "FAILED");
  const hasPending = jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING");

  if (hasFailed) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "FAILED" },
    });
    return;
  }

  if (hasPending) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "PROVISIONING" },
    });
    return;
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "ACTIVE" },
  });
}

export async function processProvisioningJob(jobId: string) {
  const job = await prisma.provisioningJob.findUnique({
    where: { id: jobId },
    include: {
      order: {
        include: {
          user: {
            include: {
              customerProfile: true,
            },
          },
          items: {
            include: {
              plan: true,
            },
          },
        },
      },
    },
  });

  if (!job || !job.order) {
    throw new Error("El provisioning job no existe o no tiene orden asociada.");
  }

  if (job.status === "SUCCEEDED") {
    return { jobId, status: "SUCCEEDED", skipped: true };
  }

  const payload = (job.payload || {}) as {
    orderItemId?: string;
    quantity?: number;
    createdServerIds?: string[];
  };

  const orderItem = job.order.items.find((item) => item.id === payload.orderItemId);

  if (!orderItem) {
    throw new Error("No se encontró el item de orden para este provisioning job.");
  }

  const pterodactylAccount = await ensurePterodactylAccount(job.order.userId);
  const defaults = await getPterodactylDefaults(orderItem.plan);
  const quantity = payload.quantity || orderItem.quantity || 1;
  const createdServerIds = payload.createdServerIds || [];

  await prisma.provisioningJob.update({
    where: { id: job.id },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      startedAt: new Date(),
    },
  });

  try {
    for (let index = createdServerIds.length; index < quantity; index += 1) {
      const suffix = quantity > 1 ? ` #${index + 1}` : "";
      const serverName = `${orderItem.plan.name}${suffix}`;

      const serverRecord = await prisma.server.create({
        data: {
          userId: job.order.userId,
          planId: orderItem.planId,
          pterodactylAccountId: pterodactylAccount.id,
          status: "PROVISIONING",
          name: serverName,
          nodeLabel: orderItem.plan.pterodactylNodeHint || null,
          locationLabel: orderItem.locationsSnapshot.join(" / "),
        },
      });

      const created = await createPterodactylServer({
        externalId: `gideon-server-${serverRecord.id}`,
        name: serverName,
        userId: pterodactylAccount.pterodactylUserId!,
        nestId: defaults.nestId,
        eggId: defaults.eggId,
        allocationId: defaults.allocationId,
        ramMb: defaults.ramMb,
        diskMb: defaults.diskMb,
        databases: defaults.databases,
        backups: defaults.backups,
        dockerImage: defaults.dockerImage,
        startup: defaults.startup,
        environment: defaults.environment,
      });

      const panelBase = env.PTERODACTYL_CLIENT_URL || env.PTERODACTYL_URL || "";

      await prisma.server.update({
        where: { id: serverRecord.id },
        data: {
          status: "ACTIVE",
          pterodactylServerId: created.attributes.id,
          pterodactylIdentifier: created.attributes.identifier,
          pterodactylUuid: created.attributes.uuid,
          panelUrl: panelBase ? `${panelBase}/server/${created.attributes.identifier}` : null,
          provisionedAt: new Date(),
        },
      });

      createdServerIds.push(serverRecord.id);
    }

    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        lastError: null,
        payload: {
          ...payload,
          createdServerIds,
          quantity,
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: job.order.userId,
        action: "pterodactyl.server.provisioned",
        entityType: "provisioning_job",
        entityId: job.id,
        meta: {
          createdServerIds,
          orderId: job.orderId,
          orderItemId: payload.orderItemId,
        },
      },
    });
  } catch (error) {
    await prisma.provisioningJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        lastError: error instanceof Error ? error.message : "Error desconocido",
        payload: {
          ...payload,
          createdServerIds,
          quantity,
        },
      },
    });

    await refreshOrderProvisioningState(job.orderId!);
    throw error;
  }

  await refreshOrderProvisioningState(job.orderId!);

  return {
    jobId: job.id,
    status: "SUCCEEDED",
    createdServerIds,
  };
}

export async function processPendingProvisioningJobs(limit = 10) {
  const jobs = await prisma.provisioningJob.findMany({
    where: {
      status: {
        in: ["PENDING", "FAILED"],
      },
      jobType: "PTERODACTYL_CREATE_SERVER",
    },
    orderBy: {
      createdAt: "asc",
    },
    take: limit,
  });

  const results = [];

  for (const job of jobs) {
    try {
      const result = await processProvisioningJob(job.id);
      results.push(result);
    } catch (error) {
      results.push({
        jobId: job.id,
        status: "FAILED",
        error: error instanceof Error ? error.message : "Error desconocido",
      });
    }
  }

  return results;
}
