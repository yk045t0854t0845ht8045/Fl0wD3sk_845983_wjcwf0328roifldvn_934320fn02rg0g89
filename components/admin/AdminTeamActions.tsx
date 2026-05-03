"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminRoleSummary, AdminTeamMember } from "@/lib/admin/read";

type AdminTeamActionsProps = {
  members: AdminTeamMember[];
  roles: AdminRoleSummary[];
};

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

export function AdminTeamActions({
  members,
  roles,
}: AdminTeamActionsProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();

  const assignableMembers = useMemo(
    () => members.filter((member) => member.status !== "disabled" && member.status !== "suspended"),
    [members],
  );
  const activeAssignmentOptions = useMemo(
    () =>
      members.flatMap((member) =>
        member.activeRoles.map((role) => ({
          value: role.assignmentId,
          label: `${member.displayName} -> ${role.roleName}`,
        })),
      ),
    [members],
  );

  const [assignStaffProfileId, setAssignStaffProfileId] = useState(
    () => assignableMembers[0]?.id || "",
  );
  const [assignRoleId, setAssignRoleId] = useState(() => roles[0]?.id || "");
  const [assignReason, setAssignReason] = useState("");
  const [revokeAssignmentId, setRevokeAssignmentId] = useState(
    () => activeAssignmentOptions[0]?.value || "",
  );
  const [revokeReason, setRevokeReason] = useState("");
  const [statusStaffProfileId, setStatusStaffProfileId] = useState(
    () => members[0]?.id || "",
  );
  const [nextStatus, setNextStatus] = useState<AdminTeamMember["status"]>("active");
  const [statusReason, setStatusReason] = useState("");
  const effectiveAssignStaffProfileId = assignStaffProfileId || assignableMembers[0]?.id || "";
  const effectiveAssignRoleId = assignRoleId || roles[0]?.id || "";
  const effectiveRevokeAssignmentId =
    revokeAssignmentId || activeAssignmentOptions[0]?.value || "";
  const effectiveStatusStaffProfileId = statusStaffProfileId || members[0]?.id || "";

  async function submitJson(url: string, body: Record<string, unknown>, successMessage: string) {
    setFeedback(null);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = (await response.json().catch(() => null)) as
      | { ok?: boolean; message?: string }
      | null;

    if (!response.ok || !json?.ok) {
      throw new Error(json?.message || "A operacao administrativa falhou.");
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
            Acoes de equipe
          </h2>
          <p className="mt-[10px] max-w-[780px] text-[13px] leading-[1.7] text-[#737373]">
            Mutacoes seguras sobre perfis administrativos com backend protegido por permissao e auditoria obrigatoria.
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
          title="Atribuir cargo"
          description="Associa um cargo institucional a um perfil interno. Cargos singleton continuam protegidos no backend."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveAssignStaffProfileId}
              onChange={(event) => setAssignStaffProfileId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {assignableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName} ({member.primaryRole || "sem cargo"})
                </option>
              ))}
            </select>
            <select
              value={effectiveAssignRoleId}
              onChange={(event) => setAssignRoleId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <textarea
              value={assignReason}
              onChange={(event) => setAssignReason(event.target.value)}
              rows={3}
              placeholder="Motivo da atribuicao"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={isPending || !effectiveAssignStaffProfileId || !effectiveAssignRoleId}
              onClick={() => {
                void submitJson(
                  "/api/admin/team/assign-role",
                  {
                    staffProfileId: effectiveAssignStaffProfileId,
                    roleId: effectiveAssignRoleId,
                    reason: assignReason,
                  },
                  "Cargo atribuido com sucesso.",
                ).catch((error) => {
                  setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atribuir cargo." });
                });
              }}
              className="w-full rounded-[14px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-[16px] py-[12px] text-[14px] font-semibold text-[#252525] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Aplicando..." : "Atribuir cargo"}
            </button>
          </div>
        </ActionSection>

        <ActionSection
          title="Revogar atribuicao"
          description="Remove uma atribuicao ativa sem apagar historico. A trilha continua registrada na auditoria."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveRevokeAssignmentId}
              onChange={(event) => setRevokeAssignmentId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {activeAssignmentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <textarea
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              rows={3}
              placeholder="Motivo da revogacao"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={isPending || !effectiveRevokeAssignmentId}
              onClick={() => {
                void submitJson(
                  "/api/admin/team/revoke-role",
                  {
                    assignmentId: effectiveRevokeAssignmentId,
                    reason: revokeReason,
                  },
                  "Atribuicao revogada com sucesso.",
                ).catch((error) => {
                  setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Erro ao revogar atribuicao." });
                });
              }}
              className="w-full rounded-[14px] border border-[#1F1F1F] bg-[#111111] px-[16px] py-[12px] text-[14px] font-medium text-[#E2E2E2] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Aplicando..." : "Revogar atribuicao"}
            </button>
          </div>
        </ActionSection>

        <ActionSection
          title="Atualizar status"
          description="Ativa, desativa, suspende ou devolve um perfil ao estado pendente sem depender do frontend para autorizar a acao."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveStatusStaffProfileId}
              onChange={(event) => setStatusStaffProfileId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName} ({member.status})
                </option>
              ))}
            </select>
            <select
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value as AdminTeamMember["status"])}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              <option value="active">active</option>
              <option value="pending">pending</option>
              <option value="disabled">disabled</option>
              <option value="suspended">suspended</option>
            </select>
            <textarea
              value={statusReason}
              onChange={(event) => setStatusReason(event.target.value)}
              rows={3}
              placeholder="Motivo da alteracao"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={isPending || !effectiveStatusStaffProfileId}
              onClick={() => {
                void submitJson(
                  "/api/admin/team/status",
                  {
                    staffProfileId: effectiveStatusStaffProfileId,
                    status: nextStatus,
                    reason: statusReason,
                  },
                  "Status atualizado com sucesso.",
                ).catch((error) => {
                  setFeedback({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar status." });
                });
              }}
              className="w-full rounded-[14px] border border-[#1F1F1F] bg-[#111111] px-[16px] py-[12px] text-[14px] font-medium text-[#E2E2E2] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Aplicando..." : "Salvar status"}
            </button>
          </div>
        </ActionSection>
      </div>
    </div>
  );
}
