import { getAuthenticatedRequestContext } from "./auth.ts";

type DevMeResponse = {
  ok: boolean;
  projects?: Array<{
    id: string;
    code: string;
    name: string;
    allowedEnvironments: Array<"test" | "staging" | "sandbox">;
  }>;
  snapshot?: {
    currentIp: string | null;
    ipStatus: string;
    grants: Array<unknown>;
    certificates: Array<unknown>;
    ipRequests: Array<{
      id: string;
      deviceName: string;
      environment: string;
      status: string;
    }>;
  };
  message?: string;
};

type IpRequestOptions = {
  projectCode?: string | null;
  environment?: string | null;
  deviceName?: string | null;
  reason?: string | null;
  notes?: string | null;
  requestedExpiresAt?: string | null;
  baseUrl?: string | null;
};

async function requestJson<T>(
  baseUrl: string,
  pathname: string,
  init: RequestInit,
  authToken: string,
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
      ...(init.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !payload) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message || "Falha na requisicao.")
        : "Falha na requisicao.";
    throw new Error(message);
  }

  return payload;
}

export async function showIpStatus(explicitBaseUrl?: string | null) {
  const { baseUrl, authToken } = await getAuthenticatedRequestContext(explicitBaseUrl);
  const payload = await requestJson<DevMeResponse>(
    baseUrl,
    "/api/dev/me",
    { method: "GET" },
    authToken,
  );

  if (!payload.snapshot) {
    throw new Error(payload.message || "Nao foi possivel validar o IP atual.");
  }

  console.log(`IP atual: ${payload.snapshot.currentIp || "nao detectado"}`);
  console.log(`Status: ${payload.snapshot.ipStatus}`);
  console.log(`Solicitacoes recentes: ${payload.snapshot.ipRequests.length}`);
}

export async function requestIp(options: IpRequestOptions) {
  const { baseUrl, authToken } = await getAuthenticatedRequestContext(options.baseUrl);
  const me = await requestJson<DevMeResponse>(
    baseUrl,
    "/api/dev/me",
    { method: "GET" },
    authToken,
  );

  const projects = me.projects || [];
  const selectedProject =
    projects.find((project) => project.code === options.projectCode) || projects[0] || null;

  if (!selectedProject) {
    throw new Error("Nenhum projeto disponivel para solicitar IP.");
  }

  const environment =
    options.environment?.trim() ||
    selectedProject.allowedEnvironments[0] ||
    "test";

  const response = await requestJson<{ ok: boolean; requestId?: string }>(
    baseUrl,
    "/api/dev/ip/request",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: selectedProject.id,
        environment,
        deviceName: options.deviceName?.trim() || `${process.platform}-device`,
        reason: options.reason?.trim() || "Solicitacao feita pelo CLI",
        notes: options.notes?.trim() || null,
        requestedExpiresAt: options.requestedExpiresAt?.trim() || null,
      }),
    },
    authToken,
  );

  console.log(
    `Solicitacao criada para ${selectedProject.code}/${environment}. Request ID: ${response.requestId || "n/d"}`,
  );
}
