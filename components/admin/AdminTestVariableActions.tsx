"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminTestVariableRecord,
  TestVariableGroupSummary,
  TestVariableProjectSummary,
} from "@/lib/test-variables/service";

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

function buildDefaultAllowedEnvironments() {
  return ["test", "staging", "sandbox"];
}

type VariableDraft = {
  variableId: string;
  description: string;
  sensitivityLevel: "public" | "internal" | "sensitive" | "critical";
  value: string;
};

function resolveOptionId<T extends { id: string }>(
  items: readonly T[],
  preferredId: string,
) {
  if (preferredId && items.some((item) => item.id === preferredId)) {
    return preferredId;
  }

  return items[0]?.id || "";
}

function buildVariableDraft(
  variable: AdminTestVariableRecord | null,
): VariableDraft | null {
  if (!variable) {
    return null;
  }

  return {
    variableId: variable.id,
    description: variable.description || "",
    sensitivityLevel: variable.sensitivityLevel,
    value: "",
  };
}

export function AdminTestVariableActions({
  projects,
  groups,
  variables,
}: {
  projects: TestVariableProjectSummary[];
  groups: TestVariableGroupSummary[];
  variables: AdminTestVariableRecord[];
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();

  const [projectCode, setProjectCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [allowedEnvironments, setAllowedEnvironments] = useState<string[]>(
    buildDefaultAllowedEnvironments(),
  );

  const groupedGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          label: `${group.projectName} · ${group.environment} · ${group.name}`,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, "pt-BR")),
    [groups],
  );

  const [groupProjectId, setGroupProjectId] = useState(() => projects[0]?.id || "");
  const [groupEnvironment, setGroupEnvironment] = useState<"test" | "staging" | "sandbox">("test");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");

  const [variableGroupId, setVariableGroupId] = useState(
    () => groupedGroups[0]?.id || "",
  );
  const [variableKey, setVariableKey] = useState("");
  const [createVariableValue, setCreateVariableValue] = useState("");
  const [createVariableSensitivity, setCreateVariableSensitivity] = useState<
    "public" | "internal" | "sensitive" | "critical"
  >("internal");
  const [createVariableDescription, setCreateVariableDescription] = useState("");

  const [selectedVariableId, setSelectedVariableId] = useState(
    () => variables[0]?.id || "",
  );
  const [editDraft, setEditDraft] = useState<VariableDraft | null>(() =>
    buildVariableDraft(variables[0] || null),
  );

  const effectiveGroupProjectId = useMemo(
    () => resolveOptionId(projects, groupProjectId),
    [groupProjectId, projects],
  );
  const effectiveVariableGroupId = useMemo(
    () => resolveOptionId(groupedGroups, variableGroupId),
    [groupedGroups, variableGroupId],
  );
  const selectedVariable = useMemo(
    () =>
      variables.find((variable) => variable.id === selectedVariableId) ||
      variables[0] ||
      null,
    [selectedVariableId, variables],
  );
  const effectiveSelectedVariableId = selectedVariable?.id || "";
  const selectedVariableGroup =
    groups.find((group) => group.id === selectedVariable?.groupId) || null;
  const resolvedEditDraft = useMemo(() => {
    if (!selectedVariable) {
      return null;
    }

    if (editDraft?.variableId === selectedVariable.id) {
      return editDraft;
    }

    return buildVariableDraft(selectedVariable);
  }, [editDraft, selectedVariable]);

  function toggleAllowedEnvironment(environment: string) {
    setAllowedEnvironments((current) =>
      current.includes(environment)
        ? current.filter((entry) => entry !== environment)
        : [...current, environment],
    );
  }

  function updateEditDraft(patch: Partial<Omit<VariableDraft, "variableId">>) {
    setEditDraft((current) => {
      const base =
        current?.variableId === effectiveSelectedVariableId
          ? current
          : buildVariableDraft(selectedVariable);

      if (!base) {
        return current;
      }

      return {
        ...base,
        ...patch,
      };
    });
  }

  async function submit(url: string, method: string, body: Record<string, unknown>, successMessage: string) {
    setFeedback(null);
    const response = await fetch(url, {
      method,
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
            Acoes de Test Variables
          </h2>
          <p className="mt-[10px] max-w-[780px] text-[13px] leading-[1.7] text-[#737373]">
            Projetos, grupos e variaveis sensiveis seguem a mesma trilha protegida por permissao granular e auditoria server-side.
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
          title="Criar projeto"
          description="Define um projeto autorizado para grants, grupos e variaveis por ambiente."
        >
          <div className="space-y-[10px]">
            <input
              value={projectCode}
              onChange={(event) => setProjectCode(event.target.value.toLowerCase())}
              placeholder="Codigo do projeto"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Nome do projeto"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <textarea
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
              rows={3}
              placeholder="Descricao do projeto"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <div className="flex flex-wrap gap-[8px]">
              {["test", "staging", "sandbox"].map((environment) => (
                <label
                  key={environment}
                  className="inline-flex items-center gap-[8px] rounded-full border border-[#1C1C1C] bg-[#0F0F0F] px-[12px] py-[8px] text-[12px] text-[#D8D8D8]"
                >
                  <input
                    type="checkbox"
                    checked={allowedEnvironments.includes(environment)}
                    onChange={() => toggleAllowedEnvironment(environment)}
                  />
                  {environment}
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={isPending || !projectCode || !projectName || !allowedEnvironments.length}
              onClick={() => {
                void submit(
                  "/api/admin/test-variables",
                  "POST",
                  {
                    kind: "project",
                    code: projectCode,
                    name: projectName,
                    description: projectDescription,
                    allowedEnvironments,
                  },
                  "Projeto criado com sucesso.",
                ).catch((error) => {
                  setFeedback({
                    tone: "error",
                    message:
                      error instanceof Error ? error.message : "Erro ao criar projeto.",
                  });
                });
              }}
              className="w-full rounded-[14px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-[16px] py-[12px] text-[14px] font-semibold text-[#252525] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Salvando..." : "Criar projeto"}
            </button>
          </div>
        </ActionSection>

        <ActionSection
          title="Criar grupo"
          description="Organiza as chaves por ambiente e dominio funcional dentro de cada projeto."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveGroupProjectId}
              onChange={(event) => setGroupProjectId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select
              value={groupEnvironment}
              onChange={(event) =>
                setGroupEnvironment(
                  event.target.value as "test" | "staging" | "sandbox",
                )
              }
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              <option value="test">test</option>
              <option value="staging">staging</option>
              <option value="sandbox">sandbox</option>
            </select>
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Nome do grupo"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <textarea
              value={groupDescription}
              onChange={(event) => setGroupDescription(event.target.value)}
              rows={3}
              placeholder="Descricao do grupo"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={isPending || !effectiveGroupProjectId || !groupName}
              onClick={() => {
                void submit(
                  "/api/admin/test-variables",
                  "POST",
                  {
                    kind: "group",
                    projectId: effectiveGroupProjectId,
                    environment: groupEnvironment,
                    name: groupName,
                    description: groupDescription,
                  },
                  "Grupo criado com sucesso.",
                ).catch((error) => {
                  setFeedback({
                    tone: "error",
                    message:
                      error instanceof Error ? error.message : "Erro ao criar grupo.",
                  });
                });
              }}
              className="w-full rounded-[14px] border border-[#1F1F1F] bg-[#111111] px-[16px] py-[12px] text-[14px] font-medium text-[#E2E2E2] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Salvando..." : "Criar grupo"}
            </button>
          </div>
        </ActionSection>

        <ActionSection
          title="Criar variavel"
          description="Os valores sao criptografados antes de tocar o banco e so aparecem mascarados na interface."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveVariableGroupId}
              onChange={(event) => setVariableGroupId(event.target.value)}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {groupedGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
            <input
              value={variableKey}
              onChange={(event) => setVariableKey(event.target.value.toUpperCase())}
              placeholder="CHAVE_DA_VARIAVEL"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <textarea
              value={createVariableValue}
              onChange={(event) => setCreateVariableValue(event.target.value)}
              rows={4}
              placeholder="Valor sensivel"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <select
              value={createVariableSensitivity}
              onChange={(event) =>
                setCreateVariableSensitivity(
                  event.target.value as "public" | "internal" | "sensitive" | "critical",
                )
              }
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              <option value="public">public</option>
              <option value="internal">internal</option>
              <option value="sensitive">sensitive</option>
              <option value="critical">critical</option>
            </select>
            <textarea
              value={createVariableDescription}
              onChange={(event) => setCreateVariableDescription(event.target.value)}
              rows={3}
              placeholder="Descricao funcional da variavel"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <button
              type="button"
              disabled={
                isPending ||
                !effectiveVariableGroupId ||
                !variableKey ||
                !createVariableValue
              }
              onClick={() => {
                void submit(
                  "/api/admin/test-variables",
                  "POST",
                  {
                    kind: "variable",
                    groupId: effectiveVariableGroupId,
                    key: variableKey,
                    value: createVariableValue,
                    sensitivityLevel: createVariableSensitivity,
                    description: createVariableDescription,
                  },
                  "Variavel criada com sucesso.",
                ).catch((error) => {
                  setFeedback({
                    tone: "error",
                    message:
                      error instanceof Error ? error.message : "Erro ao criar variavel.",
                  });
                });
              }}
              className="w-full rounded-[14px] border border-[#1F1F1F] bg-[#111111] px-[16px] py-[12px] text-[14px] font-medium text-[#E2E2E2] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Salvando..." : "Criar variavel"}
            </button>
          </div>
        </ActionSection>

        <ActionSection
          title="Atualizar variavel"
          description="Permite rotacionar, mudar sensibilidade, trocar descricao ou desativar uma chave existente sem expor o segredo atual."
        >
          <div className="space-y-[10px]">
            <select
              value={effectiveSelectedVariableId}
              onChange={(event) => {
                const nextVariableId = event.target.value;
                setSelectedVariableId(nextVariableId);
                setEditDraft(
                  buildVariableDraft(
                    variables.find((variable) => variable.id === nextVariableId) || null,
                  ),
                );
              }}
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              {variables.map((variable) => (
                <option key={variable.id} value={variable.id}>
                  {variable.projectCode} · {variable.environment} · {variable.key}
                </option>
              ))}
            </select>
            {selectedVariable ? (
              <div className="rounded-[14px] border border-[#171717] bg-[#101010] px-[14px] py-[12px] text-[12px] text-[#9A9A9A]">
                Valor mascarado: <span className="text-[#E5E5E5]">{selectedVariable.maskedValue}</span>
                <br />
                Grupo:{" "}
                <span className="text-[#CFCFCF]">
                  {selectedVariableGroup?.projectName} · {selectedVariableGroup?.name}
                </span>
              </div>
            ) : null}
            <select
              value={resolvedEditDraft?.sensitivityLevel || "internal"}
              onChange={(event) =>
                updateEditDraft({
                  sensitivityLevel: event.target.value as
                    | "public"
                    | "internal"
                    | "sensitive"
                    | "critical",
                })
              }
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none"
            >
              <option value="public">public</option>
              <option value="internal">internal</option>
              <option value="sensitive">sensitive</option>
              <option value="critical">critical</option>
            </select>
            <textarea
              value={resolvedEditDraft?.description || ""}
              onChange={(event) =>
                updateEditDraft({ description: event.target.value })
              }
              rows={3}
              placeholder="Descricao"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <textarea
              value={resolvedEditDraft?.value || ""}
              onChange={(event) => updateEditDraft({ value: event.target.value })}
              rows={4}
              placeholder="Novo valor opcional"
              className="w-full rounded-[14px] border border-[#141414] bg-[#0F0F0F] px-[14px] py-[12px] text-[14px] text-[#E5E5E5] outline-none placeholder:text-[#5E5E5E]"
            />
            <div className="grid gap-[10px] md:grid-cols-3">
              <button
                type="button"
                disabled={isPending || !effectiveSelectedVariableId}
                onClick={() => {
                  void submit(
                    `/api/admin/test-variables/${effectiveSelectedVariableId}`,
                    "PATCH",
                    {
                      description: resolvedEditDraft?.description || "",
                      sensitivityLevel:
                        resolvedEditDraft?.sensitivityLevel || "internal",
                      value: resolvedEditDraft?.value || undefined,
                    },
                    "Variavel atualizada com sucesso.",
                  ).catch((error) => {
                    setFeedback({
                      tone: "error",
                      message:
                        error instanceof Error ? error.message : "Erro ao atualizar variavel.",
                    });
                  });
                }}
                className="rounded-[14px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-[16px] py-[12px] text-[14px] font-semibold text-[#252525] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Salvar
              </button>
              <button
                type="button"
                disabled={isPending || !effectiveSelectedVariableId}
                onClick={() => {
                  void submit(
                    `/api/admin/test-variables/${effectiveSelectedVariableId}`,
                    "PATCH",
                    {
                      rotate: true,
                      value: resolvedEditDraft?.value || undefined,
                    },
                    "Variavel rotacionada com sucesso.",
                  ).catch((error) => {
                    setFeedback({
                      tone: "error",
                      message:
                        error instanceof Error ? error.message : "Erro ao rotacionar variavel.",
                    });
                  });
                }}
                className="rounded-[14px] border border-[#1F1F1F] bg-[#111111] px-[16px] py-[12px] text-[14px] font-medium text-[#E2E2E2] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Rotacionar
              </button>
              <button
                type="button"
                disabled={isPending || !effectiveSelectedVariableId}
                onClick={() => {
                  void submit(
                    `/api/admin/test-variables/${effectiveSelectedVariableId}`,
                    "DELETE",
                    {},
                    "Variavel removida com sucesso.",
                  ).catch((error) => {
                    setFeedback({
                      tone: "error",
                      message:
                        error instanceof Error ? error.message : "Erro ao excluir variavel.",
                    });
                  });
                }}
                className="rounded-[14px] border border-[rgba(255,110,110,0.16)] bg-[rgba(255,110,110,0.08)] px-[16px] py-[12px] text-[14px] font-medium text-[#FFB5B5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Excluir
              </button>
            </div>
          </div>
        </ActionSection>
      </div>
    </div>
  );
}
