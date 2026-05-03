"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminPermissionSummary } from "@/lib/admin/read";

type FeedbackState =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null;

type AdminPermissionActionsProps = {
  permissions: AdminPermissionSummary[];
};

export function AdminPermissionActions({
  permissions,
}: AdminPermissionActionsProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedPermissionId, setSelectedPermissionId] = useState(
    () => permissions[0]?.id || "",
  );
  const [description, setDescription] = useState(
    () => permissions[0]?.description || "",
  );

  const currentPermission =
    permissions.find((permission) => permission.id === selectedPermissionId) ||
    permissions[0] ||
    null;
  const effectivePermissionId = currentPermission?.id || "";

  async function handleSubmit() {
    setFeedback(null);
    const response = await fetch(`/api/admin/permissions/${effectivePermissionId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description }),
    });
    const json = (await response.json().catch(() => null)) as
      | { ok?: boolean; message?: string }
      | null;

    if (!response.ok || !json?.ok) {
      throw new Error(json?.message || "A operacao administrativa falhou.");
    }

    setFeedback({ tone: "success", message: "Descricao da permissao atualizada." });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="mt-[18px] rounded-[24px] border border-[#141414] bg-[#090909] p-[20px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
      <div className="flex flex-col gap-[10px] md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-[20px] leading-none font-medium tracking-[-0.03em] text-[#F1F1F1]">
            Acao rapida de permissao
          </h2>
          <p className="mt-[10px] max-w-[760px] text-[13px] leading-[1.7] text-[#737373]">
            Ajuste a descricao humana de uma permissao do catalogo sem expor o controle no client-side.
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

      <div className="mt-[18px] grid gap-[14px] xl:grid-cols-[minmax(260px,0.74fr)_minmax(0,1.26fr)]">
        <div className="rounded-[20px] border border-[#141414] bg-[#0B0B0B] p-[16px]">
          <h3 className="text-[18px] leading-none font-medium tracking-[-0.03em] text-[#EFEFEF]">
            Selecionar permissao
          </h3>
          <select
            value={effectivePermissionId}
            onChange={(event) => {
              const nextPermission =
                permissions.find((permission) => permission.id === event.target.value) ||
                null;
              setSelectedPermissionId(event.target.value);
              setDescription(nextPermission?.description || "");
            }}
            className="mt-[16px] h-[260px] w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[13px] text-[#E5E5E5] outline-none"
            size={10}
          >
            {permissions.map((permission) => (
              <option key={permission.id} value={permission.id}>
                {permission.code}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-[20px] border border-[#141414] bg-[#0B0B0B] p-[16px]">
          <h3 className="text-[18px] leading-none font-medium tracking-[-0.03em] text-[#EFEFEF]">
            Editar descricao
          </h3>
          <p className="mt-[10px] text-[13px] leading-[1.65] text-[#727272]">
            Codigo ativo: {currentPermission?.code || "nenhum"}.
          </p>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={8}
            className="mt-[16px] w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
          />
          <button
            type="button"
            disabled={isPending || !effectivePermissionId}
            onClick={() => {
              void handleSubmit().catch((error) => {
                setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar permissao." });
              });
            }}
            className="mt-[16px] rounded-[14px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-[16px] py-[12px] text-[14px] font-semibold text-[#252525] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Salvando..." : "Salvar descricao"}
          </button>
        </div>
      </div>
    </div>
  );
}
