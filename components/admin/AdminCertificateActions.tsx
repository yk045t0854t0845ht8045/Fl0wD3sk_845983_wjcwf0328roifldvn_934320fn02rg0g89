"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminCertificateRecord } from "@/lib/test-variables/service";

type FeedbackState =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null;

export function AdminCertificateActions({
  certificates,
}: {
  certificates: AdminCertificateRecord[];
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();
  const activeCertificates = useMemo(
    () => certificates.filter((certificate) => certificate.status === "active"),
    [certificates],
  );
  const [certificateId, setCertificateId] = useState(
    () => activeCertificates[0]?.id || "",
  );
  const [reason, setReason] = useState("");
  const effectiveCertificateId = certificateId || activeCertificates[0]?.id || "";

  async function handleRevoke() {
    setFeedback(null);
    const response = await fetch(
      `/api/admin/test-variables/certificates/${effectiveCertificateId}/revoke`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason,
        }),
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; message?: string }
      | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message || "A revogacao do certificado falhou.");
    }

    setFeedback({
      tone: "success",
      message: "Certificado revogado com sucesso.",
    });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="mt-[18px] rounded-[24px] border border-[#141414] bg-[#090909] p-[20px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
      <div className="flex flex-col gap-[10px] md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-[20px] leading-none font-medium tracking-[-0.03em] text-[#F1F1F1]">
            Revogar certificado
          </h2>
          <p className="mt-[10px] max-w-[780px] text-[13px] leading-[1.7] text-[#737373]">
            Revogacoes de FLWIP sao persistidas no backend e invalidam o uso futuro no CLI.
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

      <div className="mt-[18px] grid gap-[14px] xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[20px] border border-[#141414] bg-[#0B0B0B] p-[16px]">
          <h3 className="text-[18px] leading-none font-medium tracking-[-0.03em] text-[#EFEFEF]">
            Certificado alvo
          </h3>
          <p className="mt-[10px] text-[13px] leading-[1.65] text-[#727272]">
            Selecione um FLWIP ativo para interromper imediatamente o uso nas leituras futuras.
          </p>
          <div className="mt-[16px] space-y-[10px]">
            <select
              value={effectiveCertificateId}
              onChange={(event) => setCertificateId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {activeCertificates.map((certificate) => (
                <option key={certificate.id} value={certificate.id}>
                  {certificate.fingerprint} · {certificate.environment}
                </option>
              ))}
            </select>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              placeholder="Motivo da revogacao"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={isPending || !effectiveCertificateId}
              onClick={() => {
                void handleRevoke().catch((error) => {
                  setFeedback({
                    tone: "error",
                    message:
                      error instanceof Error ? error.message : "Erro ao revogar certificado.",
                  });
                });
              }}
              className="w-full rounded-[14px] border border-[rgba(255,110,110,0.16)] bg-[rgba(255,110,110,0.08)] px-[16px] py-[12px] text-[14px] font-medium text-[#FFB5B5] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Revogando..." : "Revogar certificado"}
            </button>
          </div>
        </div>

        <div className="rounded-[20px] border border-[#141414] bg-[#0B0B0B] p-[16px]">
          <h3 className="text-[18px] leading-none font-medium tracking-[-0.03em] text-[#EFEFEF]">
            Impacto esperado
          </h3>
          <p className="mt-[10px] text-[13px] leading-[1.65] text-[#727272]">
            A revogacao nao apaga historico de uso. O CLI continua autenticado, mas o servidor bloqueia leituras futuras quando o certificado nao estiver mais valido para aquele IP e ambiente.
          </p>
        </div>
      </div>
    </div>
  );
}
