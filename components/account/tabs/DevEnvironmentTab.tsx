"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ShieldCheck, TerminalSquare, Wifi, KeyRound } from "lucide-react";

type DevProject = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  allowedEnvironments: Array<"test" | "staging" | "sandbox">;
  isActive: boolean;
  groupCount: number;
  variableCount: number;
};

type DevSnapshot = {
  currentIp: string | null;
  currentIpHash: string | null;
  ipStatus: "approved" | "pending" | "not_requested" | "rejected" | "blocked";
  grants: Array<{
    id: string;
    projectId: string;
    environment: "test" | "staging" | "sandbox";
    allowSensitive: boolean;
    allowCritical: boolean;
    expiresAt: string | null;
  }>;
  ipRequests: Array<{
    id: string;
    authUserId: number;
    projectId: string | null;
    environment: "test" | "staging" | "sandbox";
    deviceName: string;
    reason: string;
    requestedIpMasked: string;
    status: "pending" | "approved" | "rejected" | "review";
    createdAt: string;
    requestedExpiresAt: string | null;
  }>;
  certificates: Array<{
    id: string;
    authUserId: number;
    projectId: string;
    environment: "test" | "staging" | "sandbox";
    fingerprint: string;
    status: "active" | "expired" | "revoked" | "pending";
    expiresAt: string;
    issuedAt: string;
    lastUsedAt: string | null;
  }>;
};

type DevMeResponse = {
  ok: boolean;
  user?: {
    id: number;
    displayName: string;
    email: string | null;
    permissions: string[];
    authMethod: "session" | "token";
  };
  projects?: DevProject[];
  snapshot?: DevSnapshot;
  message?: string;
};

type FeedbackState =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null;

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as DevMeResponse | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.message || "Falha ao carregar o ambiente dev.");
  }
  return payload;
};

function Badge({
  tone,
  children,
}: {
  tone: "green" | "yellow" | "red" | "neutral";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "green"
      ? "border-[rgba(79,210,134,0.18)] bg-[rgba(79,210,134,0.08)] text-[#9FE1B8]"
      : tone === "yellow"
        ? "border-[rgba(243,180,74,0.18)] bg-[rgba(243,180,74,0.08)] text-[#F3C86F]"
        : tone === "red"
          ? "border-[rgba(255,110,110,0.18)] bg-[rgba(255,110,110,0.08)] text-[#FFB0B0]"
          : "border-[#1A1A1A] bg-[#0F0F0F] text-[#BEBEBE]";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-[10px] py-[6px] text-[11px] font-medium tracking-[0.02em] ${toneClass}`.trim()}
    >
      {children}
    </span>
  );
}

function resolveStatusTone(status: DevSnapshot["ipStatus"]) {
  if (status === "approved") return "green";
  if (status === "pending") return "yellow";
  if (status === "rejected" || status === "blocked") return "red";
  return "neutral";
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[18px]">
      <h3 className="text-[18px] font-medium tracking-[-0.03em] text-[#EEEEEE]">
        {title}
      </h3>
      {description ? (
        <p className="mt-[8px] text-[13px] leading-[1.65] text-[#767676]">
          {description}
        </p>
      ) : null}
      <div className="mt-[16px]">{children}</div>
    </section>
  );
}

export function DevEnvironmentTab() {
  const { data, error, isLoading, mutate } = useSWR<DevMeResponse>(
    "/api/dev/me",
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedEnvironment, setSelectedEnvironment] = useState<
    "test" | "staging" | "sandbox"
  >("test");
  const [deviceName, setDeviceName] = useState("Meu notebook");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [requestedExpiresAt, setRequestedExpiresAt] = useState("");

  const projects = useMemo(() => data?.projects ?? [], [data?.projects]);
  const snapshot = data?.snapshot || null;
  const selectedProject = useMemo(
    () =>
      projects.find((project) => project.id === selectedProjectId) ||
      projects[0] ||
      null,
    [projects, selectedProjectId],
  );
  const effectiveSelectedProjectId = selectedProject?.id || "";
  const availableEnvironments = selectedProject?.allowedEnvironments || ["test"];
  const effectiveSelectedEnvironment = availableEnvironments.includes(selectedEnvironment)
    ? selectedEnvironment
    : availableEnvironments[0];

  const grantsByProjectId = useMemo(() => {
    const map = new Map<string, DevSnapshot["grants"]>();
    for (const grant of snapshot?.grants || []) {
      const current = map.get(grant.projectId) || [];
      current.push(grant);
      map.set(grant.projectId, current);
    }
    return map;
  }, [snapshot?.grants]);

  async function handleSubmitRequest() {
    if (!effectiveSelectedProjectId || !reason.trim()) {
      setFeedback({
        tone: "error",
        message: "Escolha um projeto e descreva o motivo da solicitacao.",
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/dev/ip/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: effectiveSelectedProjectId,
          environment: effectiveSelectedEnvironment,
          deviceName,
          reason,
          notes,
          requestedExpiresAt: requestedExpiresAt
            ? new Date(requestedExpiresAt).toISOString()
            : null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message || "Nao foi possivel registrar a solicitacao.");
      }

      setFeedback({
        tone: "success",
        message: "Solicitacao registrada. Agora ela segue para aprovacao administrativa.",
      });
      setReason("");
      setNotes("");
      setRequestedExpiresAt("");
      await mutate();
    } catch (submitError) {
      setFeedback({
        tone: "error",
        message:
          submitError instanceof Error
            ? submitError.message
            : "Nao foi possivel registrar a solicitacao.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-[12px]">
        <div className="flowdesk-shimmer h-[160px] rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
        <div className="grid gap-[12px] lg:grid-cols-2">
          <div className="flowdesk-shimmer h-[260px] rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
          <div className="flowdesk-shimmer h-[260px] rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />
        </div>
      </div>
    );
  }

  if (error || !data?.ok || !snapshot) {
    return (
      <div className="rounded-[20px] border border-[rgba(255,110,110,0.14)] bg-[rgba(46,16,16,0.72)] px-[18px] py-[16px]">
        <p className="text-[14px] font-medium text-[#F1C3C3]">
          {error instanceof Error
            ? error.message
            : data?.message || "Ambiente dev indisponivel para esta conta."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-[16px]">
      {feedback ? (
        <div
          className={`rounded-[18px] border px-[16px] py-[14px] text-[13px] ${
            feedback.tone === "success"
              ? "border-[rgba(79,210,134,0.18)] bg-[rgba(79,210,134,0.08)] text-[#A2E8BC]"
              : "border-[rgba(255,110,110,0.18)] bg-[rgba(255,110,110,0.08)] text-[#FFB2B2]"
          }`.trim()}
        >
          {feedback.message}
        </div>
      ) : null}

      <Card
        title="Visao atual"
        description="Seu acesso de desenvolvimento depende de grant, IP credenciado e certificado FLWIP ativos para cada projeto/ambiente."
      >
        <div className="grid gap-[12px] lg:grid-cols-4">
          <div className="rounded-[18px] border border-[#151515] bg-[#0D0D0D] p-[16px]">
            <div className="flex items-center gap-[10px] text-[#EAEAEA]">
              <Wifi className="h-[16px] w-[16px]" />
              <span className="text-[13px] font-medium">IP atual</span>
            </div>
            <p className="mt-[14px] text-[22px] font-semibold tracking-[-0.04em] text-[#FFFFFF]">
              {snapshot.currentIp || "Nao detectado"}
            </p>
          </div>

          <div className="rounded-[18px] border border-[#151515] bg-[#0D0D0D] p-[16px]">
            <div className="flex items-center gap-[10px] text-[#EAEAEA]">
              <ShieldCheck className="h-[16px] w-[16px]" />
              <span className="text-[13px] font-medium">Status do IP</span>
            </div>
            <div className="mt-[14px]">
              <Badge tone={resolveStatusTone(snapshot.ipStatus)}>
                {snapshot.ipStatus.replace(/_/g, " ")}
              </Badge>
            </div>
          </div>

          <div className="rounded-[18px] border border-[#151515] bg-[#0D0D0D] p-[16px]">
            <div className="flex items-center gap-[10px] text-[#EAEAEA]">
              <KeyRound className="h-[16px] w-[16px]" />
              <span className="text-[13px] font-medium">Certificados</span>
            </div>
            <p className="mt-[14px] text-[22px] font-semibold tracking-[-0.04em] text-[#FFFFFF]">
              {snapshot.certificates.length}
            </p>
          </div>

          <div className="rounded-[18px] border border-[#151515] bg-[#0D0D0D] p-[16px]">
            <div className="flex items-center gap-[10px] text-[#EAEAEA]">
              <TerminalSquare className="h-[16px] w-[16px]" />
              <span className="text-[13px] font-medium">Grants ativos</span>
            </div>
            <p className="mt-[14px] text-[22px] font-semibold tracking-[-0.04em] text-[#FFFFFF]">
              {snapshot.grants.length}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-[12px] lg:grid-cols-[1.15fr_0.85fr]">
        <Card
          title="Solicitar credenciamento"
          description="O pedido usa o IP detectado nesta sessao e segue para aprovacao administrativa antes de liberar FLWIP."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveSelectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="w-full rounded-[14px] border border-[#151515] bg-[#101010] px-[14px] py-[12px] text-[14px] text-[#E6E6E6] outline-none"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.code})
                </option>
              ))}
            </select>
            <select
              value={effectiveSelectedEnvironment}
              onChange={(event) =>
                setSelectedEnvironment(
                  event.target.value as "test" | "staging" | "sandbox",
                )
              }
              className="w-full rounded-[14px] border border-[#151515] bg-[#101010] px-[14px] py-[12px] text-[14px] text-[#E6E6E6] outline-none"
            >
              {(selectedProject?.allowedEnvironments || ["test"]).map((environment) => (
                <option key={environment} value={environment}>
                  {environment}
                </option>
              ))}
            </select>
            <input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="Nome do dispositivo"
              className="w-full rounded-[14px] border border-[#151515] bg-[#101010] px-[14px] py-[12px] text-[14px] text-[#E6E6E6] outline-none placeholder:text-[#5F5F5F]"
            />
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              placeholder="Motivo do acesso"
              className="w-full rounded-[14px] border border-[#151515] bg-[#101010] px-[14px] py-[12px] text-[14px] text-[#E6E6E6] outline-none placeholder:text-[#5F5F5F]"
            />
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Observacoes adicionais"
              className="w-full rounded-[14px] border border-[#151515] bg-[#101010] px-[14px] py-[12px] text-[14px] text-[#E6E6E6] outline-none placeholder:text-[#5F5F5F]"
            />
            <input
              type="datetime-local"
              value={requestedExpiresAt}
              onChange={(event) => setRequestedExpiresAt(event.target.value)}
              className="w-full rounded-[14px] border border-[#151515] bg-[#101010] px-[14px] py-[12px] text-[14px] text-[#E6E6E6] outline-none"
            />
            <button
              type="button"
              disabled={isSubmitting || !effectiveSelectedProjectId || !reason.trim()}
              onClick={() => {
                void handleSubmitRequest();
              }}
              className="w-full rounded-[14px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D6D6D6_100%)] px-[16px] py-[12px] text-[14px] font-semibold text-[#242424] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Enviando..." : "Credenciar IP"}
            </button>
          </div>
        </Card>

        <Card
          title="Fluxo CLI"
          description="Os comandos abaixo seguem o fluxo oficial: login web, request de IP e injecao segura das variaveis antes do processo subir."
        >
          <div className="space-y-[10px] rounded-[18px] border border-[#141414] bg-[#070707] p-[16px] text-[13px] text-[#D4D4D4]">
            <code className="block">npm i -D @flowdesk/test-variables</code>
            <code className="block">flw login</code>
            <code className="block">flw ip request</code>
            <code className="block">flw dev -- npm run dev</code>
            <code className="block">flw env pull --project flowdesk --env test</code>
          </div>
        </Card>
      </div>

      <Card
        title="Projetos liberados"
        description="Veja os projetos disponiveis e os grants ativos associados ao seu perfil interno."
      >
        <div className="grid gap-[10px] md:grid-cols-2">
          {projects.map((project) => {
            const grants = grantsByProjectId.get(project.id) || [];
            return (
              <div
                key={project.id}
                className="rounded-[18px] border border-[#151515] bg-[#0D0D0D] p-[16px]"
              >
                <div className="flex items-start justify-between gap-[10px]">
                  <div>
                    <p className="text-[15px] font-medium text-[#F0F0F0]">
                      {project.name}
                    </p>
                    <p className="mt-[6px] text-[12px] text-[#686868]">
                      {project.code}
                    </p>
                  </div>
                  <Badge tone={grants.length ? "green" : "neutral"}>
                    {grants.length ? `${grants.length} grant(s)` : "sem grant"}
                  </Badge>
                </div>
                <p className="mt-[10px] text-[13px] leading-[1.6] text-[#787878]">
                  {project.description || "Projeto interno com acesso controlado por grant e FLWIP."}
                </p>
                <div className="mt-[12px] flex flex-wrap gap-[8px]">
                  {project.allowedEnvironments.map((environment) => (
                    <Badge key={environment} tone="neutral">
                      {environment}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-[12px] lg:grid-cols-2">
        <Card title="Solicitacoes recentes">
          <div className="space-y-[8px]">
            {snapshot.ipRequests.length ? (
              snapshot.ipRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-[16px] border border-[#151515] bg-[#0D0D0D] px-[14px] py-[12px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-[10px]">
                    <div>
                      <p className="text-[14px] font-medium text-[#EAEAEA]">
                        {request.deviceName}
                      </p>
                      <p className="mt-[5px] text-[12px] text-[#6A6A6A]">
                        {request.environment} · {request.requestedIpMasked}
                      </p>
                    </div>
                    <Badge tone={resolveStatusTone(request.status as DevSnapshot["ipStatus"])}>
                      {request.status}
                    </Badge>
                  </div>
                  <p className="mt-[10px] text-[13px] leading-[1.55] text-[#808080]">
                    {request.reason}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-[#6D6D6D]">
                Nenhuma solicitacao registrada ainda.
              </p>
            )}
          </div>
        </Card>

        <Card title="Certificados FLWIP">
          <div className="space-y-[8px]">
            {snapshot.certificates.length ? (
              snapshot.certificates.map((certificate) => (
                <div
                  key={certificate.id}
                  className="rounded-[16px] border border-[#151515] bg-[#0D0D0D] px-[14px] py-[12px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-[10px]">
                    <p className="text-[14px] font-medium text-[#EAEAEA]">
                      {certificate.fingerprint}
                    </p>
                    <Badge tone={resolveStatusTone(certificate.status as DevSnapshot["ipStatus"])}>
                      {certificate.status}
                    </Badge>
                  </div>
                  <p className="mt-[8px] text-[12px] text-[#6A6A6A]">
                    {certificate.environment} · expira em{" "}
                    {new Date(certificate.expiresAt).toLocaleString("pt-BR")}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-[#6D6D6D]">
                Nenhum certificado ativo para esta conta.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
