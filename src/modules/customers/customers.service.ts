import { prisma } from "../../lib/prisma.js";

type UpsertCustomerInput = {
  email: string;
  fullName?: string;
  discordTag?: string;
};

export async function upsertCustomer(input: UpsertCustomerInput) {
  const email = input.email.trim().toLowerCase();

  return prisma.user.upsert({
    where: { email },
    update: {
      customerProfile: {
        upsert: {
          update: {
            fullName: input.fullName?.trim() || null,
            discordTag: input.discordTag?.trim() || null,
          },
          create: {
            fullName: input.fullName?.trim() || null,
            discordTag: input.discordTag?.trim() || null,
          },
        },
      },
    },
    create: {
      email,
      customerProfile: {
        create: {
          fullName: input.fullName?.trim() || null,
          discordTag: input.discordTag?.trim() || null,
        },
      },
    },
    include: {
      customerProfile: true,
    },
  });
}
