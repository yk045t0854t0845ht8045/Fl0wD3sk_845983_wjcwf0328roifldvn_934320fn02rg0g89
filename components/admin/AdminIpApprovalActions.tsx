"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminIpRequestRecord } from "@/lib/test-variables/service";

type FeedbackState =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null;

function ActionSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[20px] border border-[#141414] bg-[#0B0B0B] p-[16px]">
      <h3 className="text-[18px] leading-none font-medium tracking-[-0.03em] text-[#EFEFEF]">
        {title}
      </h3>
      <p className="mt-[10px] text-[13px] leading-[1.65] text-[#727272]">
        {description}
      </p>
      <div className="mt-[16px]">{children}</div>
    </section>
  );
}

function buildDefaultExpiry() {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 7);
  const yyyy = nextDate.getFullYear();
  const mm = String(nextDate.getMonth() + 1).padStart(2, "0");
  const dd = String(nextDate.getDate()).padStart(2, "0");
  const hh = String(nextDate.getHours()).padStart(2, "0");
  const min = String(nextDate.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function AdminIpApprovalActions({
  requests,
}: {
  requests: AdminIpRequestRecord[];
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();
  const actionableRequests = useMemo(
    () => requests.filter((request) => request.status === "pending" || request.status === "review"),
    [requests],
  );

  const [requestId, setRequestId] = useState(
    () => actionableRequests[0]?.id || "",
  );
  const [expiresAt, setExpiresAt] = useState(buildDefaultExpiry());
  const [allowSensitive, setAllowSensitive] = useState(true);
  const [allowCritical, setAllowCritical] = useState(false);
  const [approveReason, setApproveReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const effectiveRequestId = requestId || actionableRequests[0]?.id || "";

  async function submit(url: string, body: Record<string, unknown>, successMessage: string) {
    setFeedback(null);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; message?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message || "A operacao administrativa falhou.");
    }

    setFeedback({ tone: "success", message: successMessage });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="mt-[18px] rounded-[24px] border border-[#141414] bg-[#090909] p-[20px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
      <div className="flex flex-col gap-[10px] md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-[20px] leading-none font-medium tracking-[-0.03em] text-[#F1F1F1]">
            Acoes de aprovacao
          </h2>
          <p className="mt-[10px] max-w-[780px] text-[13px] leading-[1.7] text-[#737373]">
            A aprovacao combina allowlist, grant e emissao de FLWIP em uma trilha unica e auditavel.
          </p>
        </div>

        {feedback ? (
          <div
            className={`rounded-[16px] border px-[14px] py-[10px] text-[13px] ${
              feedback.tone === "success"
                ? "border-[rgba(79,210,134,0.18)] bg-[rgba(79,210,134,0.08)] text-[#A4E8BC]"
                : "border-[rgba(255,110,110,0.18)] bg-[rgba(255,110,110,0.08)] text-[#FFB2B2]"
            }`.trim()}
          >
            {feedback.message}
          </div>
        ) : null}
      </div>

      <div className="mt-[18px] grid gap-[14px] xl:grid-cols-2">
        <ActionSection
          title="Aprovar solicitacao"
          description="Emite grant + allowlist + certificado FLWIP para o contexto solicitado."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveRequestId}
              onChange={(event) => setRequestId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {actionableRequests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.deviceName} · {request.environment} · {request.requestedIpMasked}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            />
            <label className="flex items-center gap-[10px] rounded-[14px] border border-[#171717] bg-[#101010] px-[14px] py-[12px] text-[13px] text-[#E2E2E2]">
              <input
                type="checkbox"
                checked={allowSensitive}
                onChange={(event) => setAllowSensitive(event.target.checked)}
              />
              Liberar variaveis sensitive
            </label>
            <label className="flex items-center gap-[10px] rounded-[14px] border border-[#171717] bg-[#101010] px-[14px] py-[12px] text-[13px] text-[#E2E2E2]">
              <input
                type="checkbox"
                checked={allowCritical}
                onChange={(event) => setAllowCritical(event.target.checked)}
              />
              Liberar variaveis critical
            </label>
            <textarea
              value={approveReason}
              onChange={(event) => setApproveReason(event.target.value)}
              rows={4}
              placeholder="Motivo da aprovacao"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={isPending || !effectiveRequestId || !expiresAt}
              onClick={() => {
                void submit(
                  `/api/admin/test-variables/ip-requests/${effectiveRequestId}/approve`,
                  {
                    expiresAt: new Date(expiresAt).toISOString(),
                    allowSensitive,
                    allowCritical,
                    reason: approveReason,
                  },
                  "Solicitacao aprovada com sucesso.",
                ).catch((error) => {
                  setFeedback({
                    tone: "error",
                    message:
                      error instanceof Error ? error.message : "Erro ao aprovar solicitacao.",
                  });
                });
              }}
              className="w-full rounded-[14px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-[16px] py-[12px] text-[14px] font-semibold text-[#252525] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Aprovando..." : "Aprovar e emitir FLWIP"}
            </button>
          </div>
        </ActionSection>

        <ActionSection
          title="Rejeitar solicitacao"
          description="Encerra a solicitacao mantendo historico e motivacao registrados em auditoria."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveRequestId}
              onChange={(event) => setRequestId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {actionableRequests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.deviceName} · {request.environment} · {request.requestedIpMasked}
                </option>
              ))}
            </select>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={6}
              placeholder="Motivo da rejeicao"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={isPending || !effectiveRequestId}
              onClick={() => {
                void submit(
                  `/api/admin/test-variables/ip-requests/${effectiveRequestId}/reject`,
                  {
                    reason: rejectReason,
                  },
                  "Solicitacao rejeitada com sucesso.",
                ).catch((error) => {
                  setFeedback({
                    tone: "error",
                    message:
                      error instanceof Error ? error.message : "Erro ao rejeitar solicitacao.",
                  });
                });
              }}
              className="w-full rounded-[14px] border border-[rgba(255,110,110,0.16)] bg-[rgba(255,110,110,0.08)] px-[16px] py-[12px] text-[14px] font-medium text-[#FFB5B5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Rejeitando..." : "Rejeitar"}
            </button>
          </div>
        </ActionSection>
      </div>
    </div>
  );
}
