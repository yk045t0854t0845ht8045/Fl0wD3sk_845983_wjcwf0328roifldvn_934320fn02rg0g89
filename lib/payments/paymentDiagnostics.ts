export type PaymentDiagnosticCategory =
  | "issuer"
  | "antifraud"
  | "checkout_closed"
  | "checkout_failed"
  | "validation"
  | "duplicate"
  | "timeout"
  | "processing"
  | "provider"
  | "unknown";

export type PaymentDiagnosticSnapshot = {
  category: PaymentDiagnosticCategory;
  headline: string;
  summary: string;
  recommendation: string;
  providerStatus: string | null;
  providerStatusDetail: string | null;
};

type ResolvePaymentDiagnosticInput = {
  paymentMethod: "pix" | "card" | "trial";
  status: string | null | undefined;
  providerStatus: string | null | undefined;
  providerStatusDetail: string | null | undefined;
};

function normalizeNullableText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function resolvePaymentDiagnostic(
  input: ResolvePaymentDiagnosticInput,
): PaymentDiagnosticSnapshot {
  const status = normalizeNullableText(input.status);
  const providerStatus = normalizeNullableText(input.providerStatus);
  const providerStatusDetail = normalizeNullableText(input.providerStatusDetail);
  const detailKey = providerStatusDetail || providerStatus || status || "unknown";

  switch (detailKey) {
    case "cc_rejected_high_risk":
    case "cc_rejected_blacklist":
    case "pending_contingency":
    case "pending_review_manual":
      return {
        category: "antifraud",
        headline: "Analise antifraude",
        summary:
          "O provedor ou o emissor sinalizou esta tentativa para verificacao adicional de seguranca.",
        recommendation:
          "Tente novamente com o mesmo titular e dispositivo habitual ou conclua por PIX para liberar mais rapido.",
        providerStatus,
        providerStatusDetail,
      };
    case "cc_rejected_insufficient_amount":
    case "cc_rejected_call_for_authorize":
    case "cc_rejected_card_disabled":
    case "cc_rejected_other_reason":
    case "cc_rejected_max_attempts":
      return {
        category: "issuer",
        headline: "Banco emissor",
        summary:
          "O banco emissor do cartao nao aprovou esta tentativa de pagamento.",
        recommendation:
          "Revise os dados, tente novamente com outro cartao do mesmo titular ou use PIX para concluir agora.",
        providerStatus,
        providerStatusDetail,
      };
    case "cc_rejected_bad_filled_card_number":
    case "cc_rejected_bad_filled_date":
    case "cc_rejected_bad_filled_security_code":
    case "cc_rejected_bad_filled_other":
    case "cc_rejected_invalid_installments":
      return {
        category: "validation",
        headline: "Dados do pagamento",
        summary:
          "Algum dado do cartao ou da cobranca foi rejeitado na validacao do provedor.",
        recommendation:
          "Revise numero, validade, codigo de seguranca e titularidade antes de tentar novamente.",
        providerStatus,
        providerStatusDetail,
      };
    case "cc_rejected_duplicated_payment":
    case "auto_refund_duplicate_active_license":
      return {
        category: "duplicate",
        headline: "Tentativa duplicada",
        summary:
          "Ja existia uma tentativa ou licenca ativa para este servidor, e o sistema evitou cobranca duplicada.",
        recommendation:
          "Verifique o historico de cobrancas ou aguarde a atualizacao da licenca antes de iniciar outra tentativa.",
        providerStatus,
        providerStatusDetail,
      };
    case "checkout_cancelled_by_user":
    case "checkout_returned_without_payment_confirmation":
    case "checkout_session_abandoned_or_expired":
      return {
        category: "checkout_closed",
        headline: "Checkout encerrado",
        summary:
          "O checkout com cartao foi encerrado antes da confirmacao do pagamento.",
        recommendation:
          "Abra uma nova tentativa com cartao ou escolha PIX para continuar a ativacao.",
        providerStatus,
        providerStatusDetail,
      };
    case "checkout_rejected_before_provider_confirmation":
    case "checkout_failed_before_provider_confirmation":
      return {
        category: "checkout_failed",
        headline: "Tentativa nao concluida",
        summary:
          "O checkout externo nao finalizou a confirmacao do pagamento desta tentativa.",
        recommendation:
          "Inicie um novo checkout com cartao ou conclua por PIX para evitar nova interrupcao.",
        providerStatus,
        providerStatusDetail,
      };
    case "expired":
    case "unpaid_setup_timeout_cleanup":
    case "auto_refund_after_unpaid_setup_timeout":
      return {
        category: "timeout",
        headline: "Prazo expirado",
        summary:
          "A tentativa venceu fora da janela segura de pagamento e precisou ser encerrada.",
        recommendation:
          "Reinicie a etapa de pagamento para gerar uma nova tentativa dentro do prazo.",
        providerStatus,
        providerStatusDetail,
      };
    case "in_process":
    case "pending":
    case "pending_waiting_payment":
    case "pending_waiting_transfer":
      return {
        category: "processing",
        headline: "Em processamento",
        summary:
          "O provedor ainda esta aguardando a confirmacao final desta tentativa.",
        recommendation:
          "Aguarde alguns instantes. Se nao houver atualizacao, gere uma nova tentativa segura.",
        providerStatus,
        providerStatusDetail,
      };
    default:
      if (input.paymentMethod === "card" && status === "cancelled") {
        return {
          category: "checkout_closed",
          headline: "Checkout encerrado",
          summary:
            "A tentativa com cartao foi encerrada antes da confirmacao final do pagamento.",
          recommendation:
            "Abra um novo checkout com cartao ou use PIX para continuar sem esperar.",
          providerStatus,
          providerStatusDetail,
        };
      }

      if (input.paymentMethod === "card" && status === "rejected") {
        return {
          category: "issuer",
          headline: "Pagamento nao aprovado",
          summary:
            "O cartao nao foi aprovado nesta tentativa pelo ecossistema de pagamento.",
          recommendation:
            "Tente novamente com os mesmos dados do titular habitual ou utilize PIX para concluir agora.",
          providerStatus,
          providerStatusDetail,
        };
      }

      return {
        category: "unknown",
        headline: "Status do pagamento",
        summary:
          "O sistema registrou a tentativa, mas o motivo detalhado nao foi informado de forma padronizada pelo provedor.",
        recommendation:
          "Tente novamente ou escolha PIX. Se o problema continuar, use o protocolo da tentativa para suporte.",
        providerStatus,
        providerStatusDetail,
      };
  }
}
