import { env } from "../../config/env.js";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

export type PterodactylUserResponse = {
  attributes: {
    id: number;
    external_id: string | null;
    uuid: string;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
  };
};

export type PterodactylServerResponse = {
  attributes: {
    id: number;
    external_id: string | null;
    uuid: string;
    identifier: string;
    name: string;
  };
};

function ensurePterodactylConfig() {
  if (!env.PTERODACTYL_URL || !env.PTERODACTYL_API_KEY) {
    throw new Error("Pterodactyl no está configurado todavía.");
  }
}

export async function pterodactylRequest<T>(path: string, options: RequestOptions = {}) {
  ensurePterodactylConfig();

  const response = await fetch(`${env.PTERODACTYL_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.PTERODACTYL_API_KEY}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return null as T;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Pterodactyl API error ${response.status}: ${message}`);
  }

  return (await response.json()) as T;
}

export async function findPterodactylUserByExternalId(externalId: string) {
  try {
    return await pterodactylRequest<PterodactylUserResponse>(
      `/api/application/users/external/${encodeURIComponent(externalId)}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
}

export async function createPterodactylUser(payload: {
  externalId: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
}) {
  return pterodactylRequest<PterodactylUserResponse>("/api/application/users", {
    method: "POST",
    body: {
      external_id: payload.externalId,
      email: payload.email,
      username: payload.username,
      first_name: payload.firstName,
      last_name: payload.lastName,
      language: "en",
    },
  });
}

export async function createPterodactylServer(payload: {
  externalId: string;
  name: string;
  userId: number;
  nestId: number;
  eggId: number;
  allocationId: number;
  ramMb: number;
  diskMb: number;
  databases: number;
  backups: number;
  dockerImage: string;
  startup: string;
  environment: Record<string, string>;
}) {
  return pterodactylRequest<PterodactylServerResponse>("/api/application/servers", {
    method: "POST",
    body: {
      external_id: payload.externalId,
      name: payload.name,
      user: payload.userId,
      nest: payload.nestId,
      egg: payload.eggId,
      docker_image: payload.dockerImage,
      startup: payload.startup,
      environment: payload.environment,
      limits: {
        memory: payload.ramMb,
        swap: 0,
        disk: payload.diskMb,
        io: 500,
        cpu: 0,
      },
      feature_limits: {
        databases: payload.databases,
        allocations: 1,
        backups: payload.backups,
      },
      allocation: {
        default: payload.allocationId,
      },
    },
  });
}
