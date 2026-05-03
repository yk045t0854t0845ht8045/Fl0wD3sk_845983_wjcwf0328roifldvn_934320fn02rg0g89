"use client";

import { useEffect, useState } from "react";

type CompletionState =
  | { status: "pending"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function DevAuthCompletionCard({
  attemptToken,
}: {
  attemptToken: string;
}) {
  const [state, setState] = useState<CompletionState>({
    status: "pending",
    message: "Validando sua sessao e autorizando o login do CLI...",
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const response = await fetch("/api/dev-auth/login/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            attemptToken,
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; message?: string; alreadyCompleted?: boolean }
          | null;

        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message || "Nao foi possivel concluir o login do terminal.",
          );
        }

        if (cancelled) {
          return;
        }

        setState({
          status: "success",
          message: payload.alreadyCompleted
            ? "Esta autorizacao ja estava concluida. Voce ja pode voltar ao terminal."
            : "Login confirmado. Volte ao terminal para continuar o fluxo do `flw login`.",
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel concluir o login do terminal.",
        });
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [attemptToken]);

  return (
    <div
      className={`rounded-[24px] border px-[20px] py-[18px] text-[14px] ${
        state.status === "success"
          ? "border-[rgba(79,210,134,0.18)] bg-[rgba(79,210,134,0.08)] text-[#A2E8BC]"
          : state.status === "error"
            ? "border-[rgba(255,110,110,0.18)] bg-[rgba(255,110,110,0.08)] text-[#FFB0B0]"
            : "border-[#151515] bg-[#0B0B0B] text-[#D2D2D2]"
      }`.trim()}
    >
      {state.message}
    </div>
  );
}
