"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  ChevronRight,
  Mail,
  MessageSquare,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { useNotifications } from "@/components/notifications/NotificationsProvider";
import type {
  StatusSubscriptionRecord,
  StatusSubscriptionType,
  StatusSubscriptionViewer,
} from "@/lib/status/types";

type SubscriptionStatePayload = {
  viewer: StatusSubscriptionViewer;
  subscriptions: Partial<Record<StatusSubscriptionType, StatusSubscriptionRecord>>;
  discordChannelUrl: string;
};

type StatusSubscribeModalContentProps = {
  resetSubscribeModal: () => void;
  subscribing: boolean;
  setSubscribing: (value: boolean) => void;
  initialType: StatusSubscriptionType | null;
};

function SubscriptionOption({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-4 rounded-xl border border-[#1A1A1A] bg-[#0D0D0D] p-4 text-left transition-colors hover:border-[#2A2A2A] hover:bg-[#111111]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#1A1A1A] text-white">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-[15px] font-semibold text-white">{label}</h3>
        <p className="text-[13px] text-[#666]">{description}</p>
      </div>
      <ChevronRight className="ml-auto mt-1 h-4 w-4 text-[#333]" />
    </button>
  );
}

export function StatusSubscribeModalContent({
  resetSubscribeModal,
  subscribing,
  setSubscribing,
  initialType,
}: StatusSubscribeModalContentProps) {
  const notifications = useNotifications();
  const [subscribeType, setSubscribeType] = useState<StatusSubscriptionType | null>(
    initialType,
  );
  const [loadingState, setLoadingState] = useState(true);
  const [emailTarget, setEmailTarget] = useState("");
  const [webhookTarget, setWebhookTarget] = useState("");
  const [subscriptionState, setSubscriptionState] =
    useState<SubscriptionStatePayload | null>(null);

  const activeSubscription = subscribeType
    ? subscriptionState?.subscriptions?.[subscribeType] || null
    : null;

  useEffect(() => {
    setSubscribeType(initialType);
  }, [initialType]);

  useEffect(() => {
    let alive = true;

    async function loadSubscriptionState() {
      try {
        const res = await fetch("/api/status/subscriptions", {
          cache: "no-store",
        });
        const json = await res.json();
        if (!alive || !json?.ok) return;

        const nextState: SubscriptionStatePayload = {
          viewer: json.viewer,
          subscriptions: json.subscriptions || {},
          discordChannelUrl: json.discordChannelUrl,
        };

        setSubscriptionState(nextState);
        setEmailTarget(
          (json.subscriptions?.email?.target as string | undefined) ||
            json.viewer?.email ||
            "",
        );
        setWebhookTarget((json.subscriptions?.webhook?.target as string | undefined) || "");
      } catch {
        if (!alive) return;
        notifications.error("Nao foi possivel carregar as opcoes de notificacao.", {
          title: "Notificacoes de status",
        });
      } finally {
        if (alive) {
          setLoadingState(false);
        }
      }
    }

    void loadSubscriptionState();

    return () => {
      alive = false;
    };
  }, [notifications]);

  const handleAuthRedirect = () => {
    const next = subscribeType || "discord_dm";
    window.location.assign(`/api/auth/discord?next=${encodeURIComponent(`/status?subscribe=${next}`)}`);
  };

  const handleSubscribe = async () => {
    if (!subscribeType) return;

    if (subscribeType === "discord_channel") {
      const channelUrl = subscriptionState?.discordChannelUrl;
      if (channelUrl) {
        window.open(channelUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }

    setSubscribing(true);

    try {
      const res = await fetch("/api/status/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          type: subscribeType,
          target:
            subscribeType === "email"
              ? emailTarget
              : subscribeType === "webhook"
                ? webhookTarget
                : null,
        }),
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();

      if (!json.ok) {
        if (json.code === "AUTH_REQUIRED" && json.loginUrl) {
          window.location.assign(json.loginUrl);
          return;
        }

        notifications.error(json.message || "Falha ao salvar a inscricao.", {
          title: "Notificacoes de status",
        });
        return;
      }

      setSubscriptionState({
        viewer: json.viewer,
        subscriptions: json.subscriptions || {},
        discordChannelUrl: json.discordChannelUrl,
      });
      notifications.success(
        subscribeType === "webhook"
          ? `Webhook validado e salvo com sucesso${json.validation?.responseStatus ? ` (${json.validation.responseStatus})` : ""}.`
          : subscribeType === "discord_dm"
            ? "Alertas por Discord DM ativados com sucesso."
            : "Inscricao salva com sucesso.",
        {
          title: "Notificacoes de status",
        },
      );
    } catch {
      notifications.error("Falha ao salvar a inscricao.", {
        title: "Notificacoes de status",
      });
    } finally {
      setSubscribing(false);
    }
  };

  const handleDisable = async () => {
    if (!subscribeType) return;

    setSubscribing(true);

    try {
      const res = await fetch("/api/status/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ type: subscribeType }),
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();

      if (!json.ok) {
        notifications.error(json.message || "Nao foi possivel desativar a inscricao.", {
          title: "Notificacoes de status",
        });
        return;
      }

      setSubscriptionState({
        viewer: json.viewer,
        subscriptions: json.subscriptions || {},
        discordChannelUrl: json.discordChannelUrl,
      });
      if (subscribeType === "webhook") {
        setWebhookTarget("");
      }
      notifications.success("Inscricao atualizada com sucesso.", {
        title: "Notificacoes de status",
      });
    } catch {
      notifications.error("Falha ao desativar a inscricao.", {
        title: "Notificacoes de status",
      });
    } finally {
      setSubscribing(false);
    }
  };

  const viewer = subscriptionState?.viewer;
  const requiresAccount =
    subscribeType === "discord_dm" || subscribeType === "webhook";
  const isAuthenticated = Boolean(viewer?.authenticated);

  const renderSelectedType = () => {
    if (!subscribeType) return null;

    if (loadingState) {
      return (
        <div className="mt-8 flex min-h-[180px] items-center justify-center">
          <ButtonLoader size={24} colorClassName="text-white" />
        </div>
      );
    }

    if (subscribeType === "discord_channel") {
      return (
        <div className="mt-8 space-y-5">
          <div className="rounded-[18px] border border-[#171717] bg-[#0A0A0A] p-5">
            <p className="text-[14px] leading-[1.7] text-[#8C8C8C]">
              O canal oficial da Flowdesk no Discord concentra os avisos da equipe e as
              atualizacoes operacionais.
            </p>
          </div>
          <LandingActionButton
            variant="light"
            onClick={handleSubscribe}
            className="w-full !h-[46px] !rounded-[14px]"
          >
            Abrir canal oficial
          </LandingActionButton>
        </div>
      );
    }

    if (requiresAccount && !isAuthenticated) {
      return (
        <div className="mt-8 space-y-5">
          <div className="rounded-[18px] border border-[#171717] bg-[#0A0A0A] p-5">
            <p className="text-[14px] leading-[1.7] text-[#8C8C8C]">
              Para ativar {subscribeType === "discord_dm" ? "o Discord DM" : "o webhook"},
              conecte sua conta. Depois do login voce volta para esta mesma tela com o card
              aberto.
            </p>
          </div>
          <LandingActionButton
            variant="light"
            onClick={handleAuthRedirect}
            className="w-full !h-[46px] !rounded-[14px]"
          >
            Entrar com Discord
          </LandingActionButton>
        </div>
      );
    }

    if (subscribeType === "discord_dm") {
      return (
        <div className="mt-8 space-y-5">
          <div className="rounded-[18px] border border-[#171717] bg-[#0A0A0A] p-5">
            <div className="flex items-center gap-4">
              {viewer?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={viewer.avatarUrl}
                  alt={viewer.displayName || viewer.username || "Perfil"}
                  className="h-14 w-14 rounded-full border border-[#1D1D1D] object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#1D1D1D] bg-[#111] text-[18px] font-semibold text-white">
                  {(viewer?.displayName || viewer?.username || "F").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-[13px] text-[#777]">Conta conectada</p>
                <h3 className="text-[18px] font-semibold text-white">
                  {viewer?.displayName || viewer?.username || "Usuario"}
                </h3>
                <p className="text-[13px] text-[#777]">
                  {activeSubscription
                    ? "As atualizacoes ja estao ativas nesta conta."
                    : "Ative as mensagens diretas para receber alertas de status."}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {activeSubscription && (
              <LandingActionButton
                variant="dark"
                onClick={handleDisable}
                disabled={subscribing}
                className="flex-1 sm:flex-none !h-[46px] !rounded-[14px] sm:min-w-[140px]"
              >
                Desativar
              </LandingActionButton>
            )}
            <LandingActionButton
              variant="light"
              onClick={handleSubscribe}
              disabled={subscribing}
              className="flex-1 sm:flex-none !h-[46px] !rounded-[14px] sm:min-w-[160px]"
            >
              {subscribing ? (
                <ButtonLoader size={20} colorClassName="text-[#282828] mx-auto" />
              ) : activeSubscription ? (
                "Atualizar DM"
              ) : (
                "Ativar Discord DM"
              )}
            </LandingActionButton>
          </div>
        </div>
      );
    }

    if (subscribeType === "webhook") {
      return (
        <div className="mt-8 space-y-5">
          <div className="rounded-[18px] border border-[#171717] bg-[#0A0A0A] p-5">
            <p className="text-[14px] leading-[1.7] text-[#8C8C8C]">
              Salve um unico webhook por conta. Se trocar a URL, a Flowdesk substitui a
              anterior e valida o destino automaticamente.
            </p>
            {activeSubscription && (
              <div className="mt-4 rounded-[14px] border border-[#1C1C1C] bg-[#060606] p-4">
                <p className="text-[12px] uppercase tracking-[0.18em] text-[#5F5F5F]">
                  Webhook atual
                </p>
                <p className="mt-2 break-all text-[14px] text-white">{activeSubscription.target}</p>
                {activeSubscription.last_delivery_status && (
                  <p className="mt-2 text-[12px] text-[#7E7E7E]">
                    Ultima validacao: HTTP {activeSubscription.last_delivery_status}
                  </p>
                )}
              </div>
            )}
          </div>
          <input
            type="url"
            value={webhookTarget}
            onChange={(e) => setWebhookTarget(e.target.value)}
            placeholder="https://meusite.com/webhook/flowdesk"
            className="w-full rounded-[14px] border border-[#171717] bg-[#070707] px-5 py-4 text-[15px] text-white outline-none ring-[#0070FF]/20 transition-all focus:border-[#0070FF] focus:ring-4"
            autoFocus
          />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {activeSubscription && (
              <LandingActionButton
                variant="dark"
                onClick={handleDisable}
                disabled={subscribing}
                className="flex-1 sm:flex-none !h-[46px] !rounded-[14px] sm:min-w-[140px]"
              >
                Remover
              </LandingActionButton>
            )}
            <LandingActionButton
              variant="light"
              onClick={handleSubscribe}
              disabled={subscribing || !webhookTarget.trim()}
              className="flex-1 sm:flex-none !h-[46px] !rounded-[14px] sm:min-w-[180px]"
            >
              {subscribing ? (
                <ButtonLoader size={20} colorClassName="text-[#282828] mx-auto" />
              ) : activeSubscription ? (
                "Substituir webhook"
              ) : (
                "Validar e salvar"
              )}
            </LandingActionButton>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-8 space-y-5">
        <input
          type="email"
          value={emailTarget}
          onChange={(e) => setEmailTarget(e.target.value)}
          placeholder="voce@email.com"
          className="w-full rounded-[14px] border border-[#171717] bg-[#070707] px-5 py-4 text-[15px] text-white outline-none ring-[#0070FF]/20 transition-all focus:border-[#0070FF] focus:ring-4"
          autoFocus
        />
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {activeSubscription && isAuthenticated && (
            <LandingActionButton
              variant="dark"
              onClick={handleDisable}
              disabled={subscribing}
              className="flex-1 sm:flex-none !h-[46px] !rounded-[14px] sm:min-w-[140px]"
            >
              Remover
            </LandingActionButton>
          )}
          <LandingActionButton
            variant="light"
            onClick={handleSubscribe}
            disabled={subscribing || !emailTarget.trim()}
            className="flex-1 sm:flex-none !h-[46px] !rounded-[14px] sm:min-w-[160px]"
          >
            {subscribing ? (
              <ButtonLoader size={20} colorClassName="text-[#282828] mx-auto" />
            ) : activeSubscription ? (
              "Atualizar email"
            ) : (
              "Salvar email"
            )}
          </LandingActionButton>
        </div>
      </div>
    );
  };

  return (
    <div className="relative z-10">
      <div className="flex items-start justify-between">
        {!subscribeType ? (
          <div>
            <LandingGlowTag className="px-[18px]">Notificacoes</LandingGlowTag>
            <div className="mt-[18px]">
              <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
                Receba atualizacoes
              </h2>
              <p className="mt-[14px] text-[14px] leading-[1.62] text-[#787878]">
                Escolha como deseja acompanhar as mudancas no status do sistema.
              </p>
            </div>
          </div>
        ) : (
          <div>
            <button
              onClick={() => setSubscribeType(null)}
              className="mb-6 flex items-center gap-2 text-[13px] text-[#666] transition-colors hover:text-white"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
              Voltar para opcoes
            </button>

            <LandingGlowTag className="px-[18px]">Configuracao</LandingGlowTag>
            <div className="mt-[18px]">
              <h2 className="bg-[linear-gradient(90deg,#DADADA_0%,#C1C1C1_100%)] bg-clip-text text-[30px] leading-[0.98] font-normal tracking-[-0.05em] text-transparent sm:text-[36px]">
                {subscribeType === "email"
                  ? "Atualizacoes por email"
                  : subscribeType === "discord_dm"
                    ? "Discord DM"
                    : subscribeType === "webhook"
                      ? "Webhook"
                      : "Canal Discord"}
              </h2>
              <p className="mt-[14px] text-[14px] leading-[1.62] text-[#787878]">
                {subscribeType === "email"
                  ? "Receba avisos diretamente no seu email."
                  : subscribeType === "discord_dm"
                    ? "Use sua conta conectada para receber mensagens diretas."
                    : subscribeType === "webhook"
                      ? "Salve uma URL valida para receber eventos de status."
                      : "Abra o canal oficial da Flowdesk no Discord."}
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={resetSubscribeModal}
          className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
          aria-label="Fechar modal"
        >
          <span className="text-[18px] leading-none">x</span>
        </button>
      </div>

      {!subscribeType ? (
        <div className="mt-8 space-y-3">
          <SubscriptionOption
            icon={Mail}
            label="Email"
            description="Receba alertas diretamente na sua caixa de entrada."
            onClick={() => setSubscribeType("email")}
          />
          <SubscriptionOption
            icon={MessageSquare}
            label="Discord DM"
            description="Alertas via mensagem direta na sua conta conectada."
            onClick={() => setSubscribeType("discord_dm")}
          />
          <SubscriptionOption
            icon={Webhook}
            label="Webhook"
            description="Integre alertas com Discord Webhook ou endpoint HTTP proprio."
            onClick={() => setSubscribeType("webhook")}
          />
          <SubscriptionOption
            icon={Bell}
            label="Canal do Discord"
            description="Abra o canal oficial da Flowdesk no Discord."
            onClick={() => setSubscribeType("discord_channel")}
          />
        </div>
      ) : (
        <>
          {renderSelectedType()}
          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <LandingActionButton
              variant="dark"
              onClick={resetSubscribeModal}
              className="flex-1 sm:flex-none !h-[46px] !rounded-[14px] sm:min-w-[120px]"
            >
              Fechar
            </LandingActionButton>
          </div>
        </>
      )}
    </div>
  );
}
