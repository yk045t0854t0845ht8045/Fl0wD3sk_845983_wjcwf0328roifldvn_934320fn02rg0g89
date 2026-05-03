"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminPermissionSummary,
  AdminRoleSummary,
  AdminTeamMember,
} from "@/lib/admin/read";

type FeedbackState =
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }
  | null;

type AdminRoleActionsProps = {
  roles: AdminRoleSummary[];
  permissions: AdminPermissionSummary[];
  members: AdminTeamMember[];
};

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

export function AdminRoleActions({
  roles,
  permissions,
  members,
}: AdminRoleActionsProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();

  const singletonRoles = useMemo(
    () => roles.filter((role) => role.isSingleton),
    [roles],
  );
  const eligibleMembers = useMemo(
    () => members.filter((member) => member.status === "active" || member.status === "pending"),
    [members],
  );

  const [descriptionRoleId, setDescriptionRoleId] = useState(
    () => roles[0]?.id || "",
  );
  const [descriptionText, setDescriptionText] = useState(
    () => roles[0]?.description || "",
  );
  const [permissionRoleId, setPermissionRoleId] = useState(
    () => roles[0]?.id || "",
  );
  const [selectedPermissionCodes, setSelectedPermissionCodes] = useState<string[]>(
    () => roles[0]?.permissionCodes || [],
  );
  const [transferRoleId, setTransferRoleId] = useState(
    () => singletonRoles[0]?.id || "",
  );
  const [transferStaffProfileId, setTransferStaffProfileId] = useState(
    () => eligibleMembers[0]?.id || "",
  );
  const [transferReason, setTransferReason] = useState("");

  const currentDescriptionRole = roles.find((role) => role.id === descriptionRoleId) || roles[0] || null;
  const currentPermissionRole = roles.find((role) => role.id === permissionRoleId) || roles[0] || null;
  const effectiveDescriptionRoleId = currentDescriptionRole?.id || "";
  const effectivePermissionRoleId = currentPermissionRole?.id || "";
  const effectiveTransferRoleId = transferRoleId || singletonRoles[0]?.id || "";
  const effectiveTransferStaffProfileId =
    transferStaffProfileId || eligibleMembers[0]?.id || "";

  async function submitRequest(
    input: {
      url: string;
      method: "PATCH" | "POST" | "PUT";
      body: Record<string, unknown>;
      successMessage: string;
    },
  ) {
    setFeedback(null);
    const response = await fetch(input.url, {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.body),
    });
    const json = (await response.json().catch(() => null)) as
      | { ok?: boolean; message?: string }
      | null;

    if (!response.ok || !json?.ok) {
      throw new Error(json?.message || "A operacao administrativa falhou.");
    }

    setFeedback({ tone: "success", message: input.successMessage });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="mt-[18px] rounded-[24px] border border-[#141414] bg-[#090909] p-[20px] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
      <div className="flex flex-col gap-[10px] md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-[20px] leading-none font-medium tracking-[-0.03em] text-[#F1F1F1]">
            Acoes de cargos
          </h2>
          <p className="mt-[10px] max-w-[780px] text-[13px] leading-[1.7] text-[#737373]">
            Mutacoes baseadas nos endpoints administrativos protegidos para descricao, permission set e transferencia segura de cargos singleton.
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

      <div className="mt-[18px] grid gap-[14px] xl:grid-cols-3">
        <ActionSection
          title="Descricao do cargo"
          description="Atualiza a descricao institucional do cargo selecionado sem alterar sua hierarquia nem a chave do catalogo."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveDescriptionRoleId}
              onChange={(event) => {
                const nextRole =
                  roles.find((role) => role.id === event.target.value) || null;
                setDescriptionRoleId(event.target.value);
                setDescriptionText(nextRole?.description || "");
              }}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <textarea
              value={descriptionText}
              onChange={(event) => setDescriptionText(event.target.value)}
              rows={5}
              placeholder="Descricao do cargo"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={isPending || !effectiveDescriptionRoleId}
              onClick={() => {
                void submitRequest({
                  url: `/api/admin/roles/${effectiveDescriptionRoleId}`,
                  method: "PATCH",
                  body: { description: descriptionText },
                  successMessage: "Descricao do cargo atualizada.",
                }).catch((error) => {
                  setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar descricao." });
                });
              }}
              className="w-full rounded-[14px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-[16px] py-[12px] text-[14px] font-semibold text-[#252525] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Salvando..." : "Salvar descricao"}
            </button>
          </div>
        </ActionSection>

        <ActionSection
          title="Permission set"
          description="Mantem o conjunto granular de permissoes por cargo com persistencia em `admin_role_permissions`."
        >
          <div className="space-y-[10px]">
            <select
              value={effectivePermissionRoleId}
              onChange={(event) => {
                const nextRole =
                  roles.find((role) => role.id === event.target.value) || null;
                setPermissionRoleId(event.target.value);
                setSelectedPermissionCodes(nextRole?.permissionCodes || []);
              }}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <select
              multiple
              value={selectedPermissionCodes}
              onChange={(event) =>
                setSelectedPermissionCodes(
                  Array.from(event.target.selectedOptions).map((option) => option.value),
                )
              }
              className="h-[220px] w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[13px] text-[#E5E5E5] outline-none"
            >
              {permissions.map((permission) => (
                <option key={permission.id} value={permission.code}>
                  {permission.code}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isPending || !effectivePermissionRoleId}
              onClick={() => {
                void submitRequest({
                  url: `/api/admin/roles/${effectivePermissionRoleId}/permissions`,
                  method: "PUT",
                  body: { permissionCodes: selectedPermissionCodes },
                  successMessage: "Permission set atualizado.",
                }).catch((error) => {
                  setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar permissoes do cargo." });
                });
              }}
              className="w-full rounded-[14px] border border-[#1F1F1F] bg-[#111111] px-[16px] py-[12px] text-[14px] font-medium text-[#E2E2E2] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Salvando..." : "Salvar permission set"}
            </button>
          </div>
        </ActionSection>

        <ActionSection
          title="Transferir singleton"
          description="Executa a troca segura de cargos unicos, mantendo a trilha de auditoria e evitando duplicidade ativa."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveTransferRoleId}
              onChange={(event) => setTransferRoleId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {singletonRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <select
              value={effectiveTransferStaffProfileId}
              onChange={(event) => setTransferStaffProfileId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {eligibleMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
            <textarea
              value={transferReason}
              onChange={(event) => setTransferReason(event.target.value)}
              rows={4}
              placeholder="Motivo da transferencia"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={isPending || !effectiveTransferRoleId || !effectiveTransferStaffProfileId}
              onClick={() => {
                void submitRequest({
                  url: `/api/admin/roles/${effectiveTransferRoleId}/transfer`,
                  method: "POST",
                  body: {
                    toStaffProfileId: effectiveTransferStaffProfileId,
                    reason: transferReason,
                  },
                  successMessage: "Transferencia do cargo singleton concluida.",
                }).catch((error) => {
                  setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Erro ao transferir cargo singleton." });
                });
              }}
              className="w-full rounded-[14px] border border-[#1F1F1F] bg-[#111111] px-[16px] py-[12px] text-[14px] font-medium text-[#E2E2E2] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Transferindo..." : "Transferir cargo"}
            </button>
          </div>
        </ActionSection>
      </div>
    </div>
  );
}
