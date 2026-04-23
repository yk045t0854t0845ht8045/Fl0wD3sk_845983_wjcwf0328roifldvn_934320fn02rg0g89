import { NextResponse } from "next/server";
import {
  cancelMercadoPagoCardPayment,
  fetchMercadoPagoPaymentById,
  resolvePaymentStatus,
} from "@/lib/payments/mercadoPago";
import { ensureCheckoutAccessTokenForOrder } from "@/lib/payments/checkoutLinkSecurity";
import { reconcilePaymentOrderWithProviderPayment } from "@/lib/payments/reconciliation";
import {
  applyNoStoreHeaders,
  ensureSameOriginJsonMutationRequest,
} from "@/lib/security/http";
import {
  attachRequestId,
  createSecurityRequestContext,
  extendSecurityRequestContext,
  logSecurityAuditEventSafe,
} from "@/lib/security/requestSecurity";
import {
  resolveDatabaseFailureMessage,
  resolveDatabaseFailureStatus,
} from "@/lib/security/databaseAvailability";
import { sanitizeErrorMessage } from "@/lib/security/errors";
import {
  flowSecureDto,
  FlowSecureDtoError,
  parseFlowSecureDto,
} from "@/lib/security/flowSecure";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import {
  createPaymentOrderEventSafe,
  ensureGuildAccess,
  getOrderByCodeForUserAndGuild,
  invalidatePaymentReadCachesForOrder,
  normalizeGuildId,
  PAYMENT_ORDER_SELECT_COLUMNS,
  toApiOrder,
  type PaymentOrderRecord,
} from "../../pix/route";

export async function POST(request: Request) {
  const requestContext = createSecurityRequestContext(request);
  let auditContext = requestContext;
  const respond = (body: unknown, init?: ResponseInit) =>
    attachRequestId(
      applyNoStoreHeaders(NextResponse.json(body, init)),
      requestContext.requestId,
    );

  try {
    const originGuard = ensureSameOriginJsonMutationRequest(request);
    if (originGuard) {
      return attachRequestId(
        applyNoStoreHeaders(originGuard),
        requestContext.requestId,
      );
    }

    let payload: {
      guildId?: string | null;
      orderNumber: number;
    };
    try {
      payload = parseFlowSecureDto(
        await request.json().catch(() => ({})),
        {
          guildId: flowSecureDto.optional(
            flowSecureDto.nullable(flowSecureDto.discordSnowflake()),
          ),
          orderNumber: flowSecureDto.number({
            integer: true,
            min: 1,
            max: 999_999_999_999,
          }),
        },
        {
          rejectUnknown: true,
        },
      );
    } catch (error) {
      return respond(
        {
          ok: false,
          message:
            error instanceof FlowSecureDtoError
              ? error.issues[0] || error.message
              : "Payload JSON invalido.",
        },
        { status: 400 },
      );
    }

    const guildId = normalizeGuildId(payload.guildId);
    const orderNumber = payload.orderNumber;

    const access = await ensureGuildAccess(guildId);
    if (!access.ok) {
      return attachRequestId(
        applyNoStoreHeaders(access.response),
        requestContext.requestId,
      );
    }

    auditContext = extendSecurityRequestContext(requestContext, {
      sessionId: access.context.sessionData.authSession.id,
      userId: access.context.sessionData.authSession.user.id,
      guildId,
    });

    const lookup = await getOrderByCodeForUserAndGuild(
      access.context.sessionData.authSession.user.id,
      guildId,
      orderNumber,
    );

    if (!lookup.order) {
      return respond(
        {
          ok: false,
          message: lookup.foreignOwner
            ? "Esse checkout pertence a outra conta autenticada."
            : "Pedido nao encontrado para cancelamento.",
        },
        { status: lookup.foreignOwner ? 403 : 404 },
      );
    }

    const order = lookup.order;
    if (order.payment_method !== "card") {
      return respond(
        {
          ok: false,
          message: "Apenas checkouts com cartao podem ser cancelados aqui.",
        },
        { status: 409 },
      );
    }

    if (order.status !== "pending") {
      const securedOrder = await ensureCheckoutAccessTokenForOrder({
        order,
        forceRotate: false,
        invalidateOtherOrders: false,
      });

      return respond({
        ok: true,
        order: toApiOrder(
          securedOrder.order,
          securedOrder.checkoutAccessToken,
        ),
      });
    }

    if (order.provider_payment_id) {
      try {
        const providerSnapshot = await fetchMercadoPagoPaymentById(
          order.provider_payment_id,
          {
            useCardToken: true,
            forceFresh: true,
          },
        );
        const resolvedProviderStatus = resolvePaymentStatus(providerSnapshot.status);
        if (resolvedProviderStatus !== "pending") {
          const reconciled = await reconcilePaymentOrderWithProviderPayment(
            order as Parameters<typeof reconcilePaymentOrderWithProviderPayment>[0],
            providerSnapshot,
            {
              source: "payment_card_cancel_preflight",
            },
          );
          const hydratedOrder = {
            ...order,
            ...reconciled.order,
            guild_id: guildId,
          } as PaymentOrderRecord;
          const securedOrder = await ensureCheckoutAccessTokenForOrder({
            order: hydratedOrder,
            forceRotate: false,
            invalidateOtherOrders: false,
          });

          return respond({
            ok: true,
            order: toApiOrder(
              securedOrder.order,
              securedOrder.checkoutAccessToken,
            ),
          });
        }
      } catch {
        // melhor esforco; seguimos para a tentativa de cancelamento do provedor
      }
    }

    if (order.provider_payment_id) {
      try {
        await cancelMercadoPagoCardPayment(order.provider_payment_id);
        const providerSnapshot = await fetchMercadoPagoPaymentById(
          order.provider_payment_id,
          {
            useCardToken: true,
            forceFresh: true,
          },
        );
        const resolvedProviderStatus = resolvePaymentStatus(providerSnapshot.status);
        if (resolvedProviderStatus !== "pending") {
          const reconciled = await reconcilePaymentOrderWithProviderPayment(
            order as Parameters<typeof reconcilePaymentOrderWithProviderPayment>[0],
            providerSnapshot,
            {
              source: "payment_card_cancel_post_provider",
            },
          );
          const hydratedOrder = {
            ...order,
            ...reconciled.order,
            guild_id: guildId,
          } as PaymentOrderRecord;
          const securedOrder = await ensureCheckoutAccessTokenForOrder({
            order: hydratedOrder,
            forceRotate: false,
            invalidateOtherOrders: false,
          });

          return respond({
            ok: true,
            order: toApiOrder(
              securedOrder.order,
              securedOrder.checkoutAccessToken,
            ),
          });
        }
      } catch {
        try {
          const providerSnapshot = await fetchMercadoPagoPaymentById(
            order.provider_payment_id,
            {
              useCardToken: true,
              forceFresh: true,
            },
          );
          const resolvedProviderStatus = resolvePaymentStatus(providerSnapshot.status);
          if (resolvedProviderStatus !== "pending") {
            const reconciled = await reconcilePaymentOrderWithProviderPayment(
              order as Parameters<typeof reconcilePaymentOrderWithProviderPayment>[0],
              providerSnapshot,
              {
                source: "payment_card_cancel_provider_recovery",
              },
            );
            const hydratedOrder = {
              ...order,
              ...reconciled.order,
              guild_id: guildId,
            } as PaymentOrderRecord;
            const securedOrder = await ensureCheckoutAccessTokenForOrder({
              order: hydratedOrder,
              forceRotate: false,
              invalidateOtherOrders: false,
            });

            return respond({
              ok: true,
              order: toApiOrder(
                securedOrder.order,
                securedOrder.checkoutAccessToken,
              ),
            });
          }
        } catch {
          // se nem o cancelamento nem a confirmacao do status funcionarem,
          // nao cancelamos localmente para evitar estado falso.
        }

        return respond(
          {
            ok: false,
            message:
              "Nao foi possivel confirmar o cancelamento seguro do checkout com cartao agora. Aguarde alguns instantes e tente novamente.",
          },
          { status: 409 },
        );
      }
    }

    const supabase = getSupabaseAdminClientOrThrow();
    const cancelledOrderResult = await supabase
      .from("payment_orders")
      .update({
        status: "cancelled",
        provider_status: "cancelled",
        provider_status_detail: "cancelled_by_user",
      })
      .eq("id", order.id)
      .eq("status", "pending")
      .select(PAYMENT_ORDER_SELECT_COLUMNS)
      .single<PaymentOrderRecord>();

    if (cancelledOrderResult.error || !cancelledOrderResult.data) {
      throw new Error(
        cancelledOrderResult.error?.message ||
          "Falha ao cancelar checkout com cartao.",
      );
    }

    invalidatePaymentReadCachesForOrder(cancelledOrderResult.data);
    await createPaymentOrderEventSafe(
      cancelledOrderResult.data.id,
      "hosted_card_checkout_cancelled",
      {
        orderNumber: cancelledOrderResult.data.order_number,
        providerPaymentId: cancelledOrderResult.data.provider_payment_id,
      },
    );

    const securedOrder = await ensureCheckoutAccessTokenForOrder({
      order: cancelledOrderResult.data,
      forceRotate: false,
      invalidateOtherOrders: false,
    });

    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_cancel_post",
      outcome: "succeeded",
      metadata: {
        orderNumber: securedOrder.order.order_number,
      },
    });

    return respond({
      ok: true,
      order: toApiOrder(securedOrder.order, securedOrder.checkoutAccessToken),
    });
  } catch (error) {
    await logSecurityAuditEventSafe(auditContext, {
      action: "payment_card_cancel_post",
      outcome: "failed",
      metadata: {
        message: sanitizeErrorMessage(
          error,
          "Erro ao cancelar checkout com cartao.",
        ),
      },
    });

    return respond(
      {
        ok: false,
        message: resolveDatabaseFailureMessage(
          error,
          sanitizeErrorMessage(error, "Erro ao cancelar checkout com cartao."),
        ),
      },
      { status: resolveDatabaseFailureStatus(error) },
    );
  }
}
