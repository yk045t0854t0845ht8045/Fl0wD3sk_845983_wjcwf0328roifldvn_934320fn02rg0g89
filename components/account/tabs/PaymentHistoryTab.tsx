"use client";

import React, { useState, useMemo } from "react";
import { History, CheckCircle2, XCircle, AlertCircle, QrCode, CreditCard, Search, ChevronDown, MessageSquare } from "lucide-react";
import { usePaymentHistory } from "@/hooks/useAccountData";

type OrderMethod = "pix" | "card" | "trial" | string;
type OrderStatus = "approved" | "pending" | "rejected" | "cancelled" | "expired" | "failed" | string;

type Order = {
  id: number;
  orderNumber: number;
  guildId: string;
  method: OrderMethod;
  status: OrderStatus;
  amount: number;
  currency: string;
  paidAt: string | null;
  createdAt: string;
  expiresAt?: string | null;
  providerStatus?: string | null;
  technicalLabels?: string[];
  financialSummary?: {
    coveredByInternalCredits: boolean;
    currentPlanCreditAmount: number;
    creditAppliedToTargetAmount: number;
    surplusCreditGrantedAmount: number;
    flowPointsAppliedAmount: number;
    flowPointsGrantedAmount: number;
    couponDiscountAmount: number;
    giftCardDiscountAmount: number;
    targetTotalAmount: number;
    payableBeforeDiscountsAmount: number;
  } | null;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount);
}

function resolveMethodLabel(method: OrderMethod): { label: string; icon: React.ElementType } {
  if (method === "pix") return { label: "PIX", icon: QrCode };
  if (method === "card") return { label: "Cartão", icon: CreditCard };
  if (method === "trial") return { label: "Basic", icon: CheckCircle2 };
  return { label: method ?? "—", icon: CreditCard };
}

function resolveStatusDisplay(status: OrderStatus): { label: string; color: string; icon: React.ElementType } {
  if (status === "approved") return { label: "Aprovado", color: "text-[#34A853] bg-[rgba(52,168,83,0.10)]", icon: CheckCircle2 };
  if (status === "pending") return { label: "Pendente", color: "text-[#F2C823] bg-[rgba(242,200,35,0.10)]", icon: AlertCircle };
  return { label: "Falhou", color: "text-[#DB4646] bg-[rgba(219,70,70,0.10)]", icon: XCircle };
}

function buildFinancialRows(order: Order) {
  const summary = order.financialSummary;
  if (!summary) return [];

  return [
    { label: "Total do novo ciclo", amount: summary.targetTotalAmount },
    { label: "Credito do plano usado", amount: -summary.creditAppliedToTargetAmount },
    { label: "Cupom", amount: -summary.couponDiscountAmount },
    { label: "Vale-presente", amount: -summary.giftCardDiscountAmount },
    { label: "FlowPoints usados", amount: -summary.flowPointsAppliedAmount },
    { label: "FlowPoints creditados", amount: summary.flowPointsGrantedAmount },
    { label: "Valor cobravel antes das promos", amount: summary.payableBeforeDiscountsAmount },
  ].filter((row) => Math.abs(row.amount) > 0);
}

function groupOrdersByMonth(orders: Order[]) {
  const groups = new Map<string, Order[]>();
  for (const order of orders) {
    const d = new Date(order.paidAt || order.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const existing = groups.get(key);
    if (existing) existing.push(order);
    else groups.set(key, [{ ...order, _groupLabel: label } as Order & { _groupLabel?: string }]);
  }
  // Preserve insertion order (already sorted desc)
  return Array.from(groups.entries()).map(([, list]) => ({
    label: (list[0] as Order & { _groupLabel?: string })._groupLabel ?? "",
    orders: list,
  }));
}

export function PaymentHistoryTab({ onNavigateTickets: _onNavigateTickets }: { onNavigateTickets?: () => void }) {
  void _onNavigateTickets;
  const { orders, loading } = usePaymentHistory();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "pending" | "failed">("all");
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);

  const filteredOrders = useMemo(() => {
    return orders.filter((order: Order) => {
      const matchSearch = String(order.orderNumber).includes(searchQuery);
      let mapStatus = order.status;
      if (order.status !== "approved" && order.status !== "pending") mapStatus = "failed";
      const matchStatus = statusFilter === "all" || statusFilter === mapStatus;
      return matchSearch && matchStatus;
    });
  }, [orders, searchQuery, statusFilter]);

  if (loading) {
    return (
      <div className="mt-[32px] space-y-[12px]">
        <div className="flowdesk-shimmer h-[70px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flowdesk-shimmer h-[74px] w-full rounded-[16px] border border-[#141414] bg-[#0A0A0A]" />
        ))}
      </div>
    );
  }

  const groups = groupOrdersByMonth(filteredOrders);

  return (
    <div className="mt-[32px] space-y-[24px]">
      {/* Filter Card */}
      <div className="rounded-[22px] border border-[#141414] bg-[#0A0A0A] p-[20px]">
        <div className="flex flex-col gap-[16px] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-[12px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] px-[16px] py-[12px] transition-all focus-within:border-[#222] focus-within:bg-[#0F0F0F]">
            <Search className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nº do pedido..."
              className="w-full bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#4A4A4A]"
            />
          </div>
          
          <div className="flex items-center gap-[10px]">
            <div className="flex items-center gap-[6px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] p-[4px]">
              {(["all", "approved", "pending", "failed"] as const).map((opt) => {
                const isActive = statusFilter === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => setStatusFilter(opt)}
                    className={`rounded-[10px] px-[16px] py-[8px] text-[13px] font-semibold transition-all ${
                      isActive
                        ? "bg-[#1A1A1A] text-[#EEEEEE] shadow-sm"
                        : "text-[#666666] hover:bg-[#111111] hover:text-[#A6A6A6]"
                    }`}
                  >
                    {opt === "all" ? "Todos" : opt === "approved" ? "Aprovados" : opt === "pending" ? "Pendentes" : "Falhas"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] py-[40px] px-[20px] text-center">
          <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#111111]">
            <History className="text-[#888888] h-[24px] w-[24px]" />
          </div>
          <p className="mt-[16px] text-[15px] font-medium text-[#E5E5E5]">Nenhum pagamento encontrado</p>
        </div>
      ) : (
        <div className="space-y-[24px]">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-[10px] text-[11px] uppercase tracking-[0.16em] text-[#555555] capitalize">
                {group.label}
              </p>
              <div className="space-y-[10px]">
                {group.orders.map((order) => {
                  const { label: methodLabel, icon: MethodIcon } = resolveMethodLabel(order.method);
                  const { label: statusLabel, color: statusColor, icon: StatusIcon } = resolveStatusDisplay(order.status);
                  const isFree = order.amount === 0 || order.method === "trial";
                  const isExpanded = expandedOrderId === order.id;

                  return (
                    <div
                      key={order.id}
                      className={`flex flex-col overflow-hidden rounded-[20px] border transition-all duration-300 ${
                        isExpanded ? "border-[#222222] bg-[#0C0C0C] ring-1 ring-[#1A1A1A]" : "border-[#131313] bg-[#0A0A0A] hover:border-[#1C1C1C]"
                      }`}
                    >
                      <button
                        onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                        className="flex flex-col gap-[12px] p-[18px] sm:flex-row sm:items-center sm:justify-between text-left"
                      >
                        <div className="flex items-center gap-[16px]">
                          <div className={`flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full transition-transform duration-300 ${
                            isExpanded ? "scale-110" : ""
                          } ${
                            order.status === "approved"
                              ? "bg-[rgba(52,168,83,0.08)] text-[#34A853]"
                              : order.status === "pending"
                              ? "bg-[rgba(242,200,35,0.08)] text-[#F2C823]"
                              : "bg-[rgba(219,70,70,0.08)] text-[#DB4646]"
                          }`}>
                            <StatusIcon className="h-[22px] w-[22px]" />
                          </div>

                          <div className="min-w-0">
                            <p className="text-[15px] font-bold text-[#EEEEEE] tracking-tight">
                              Pedido #{order.orderNumber}
                            </p>
                            <p className="mt-[3px] text-[13px] text-[#636363]">
                              {formatDate(order.paidAt || order.createdAt)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-[16px] sm:justify-end">
                          <div className="hidden items-center gap-[6px] rounded-[8px] border border-[#1A1A1A] bg-[#101010] px-[10px] py-[5px] md:flex">
                            <MethodIcon className="h-[13px] w-[13px] text-[#888888]" />
                            <span className="text-[12px] font-medium text-[#888888]">{methodLabel}</span>
                          </div>

                          <span className={`rounded-[8px] px-[10px] py-[4px] text-[12px] font-semibold ${statusColor}`}>
                            {statusLabel}
                          </span>

                          <p className={`min-w-[72px] text-right text-[17px] font-black ${isFree ? "text-[#34A853]" : "text-[#EEEEEE]"}`}>
                            {formatCurrency(order.amount, order.currency)}
                          </p>
                          
                          <ChevronDown className={`h-[18px] w-[18px] text-[#444] transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} />
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-[#161616] bg-[rgba(255,255,255,0.01)] p-[24px] animate-in slide-in-from-top-2">
                          {order.technicalLabels && order.technicalLabels.length > 0 ? (
                            <div className="mb-[18px] flex flex-wrap gap-[8px]">
                              {order.technicalLabels.map((label) => (
                                <span
                                  key={label}
                                  className="rounded-full border border-[#202020] bg-[#111111] px-[10px] py-[6px] text-[11px] font-semibold text-[#B8B8B8]"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          {order.financialSummary?.coveredByInternalCredits ? (
                            <div className="mb-[18px] rounded-[16px] border border-[rgba(52,168,83,0.22)] bg-[rgba(52,168,83,0.07)] px-[16px] py-[14px]">
                              <p className="text-[14px] font-semibold text-[#EAF7EE]">
                                Gratuidade registrada por credito interno
                              </p>
                              <p className="mt-[6px] text-[13px] leading-[1.6] text-[#B9DCC2]">
                                Esse pedido ficou em {formatCurrency(0, order.currency)} porque o credito proporcional do plano anterior cobriu o novo ciclo.
                                {order.financialSummary.surplusCreditGrantedAmount > 0
                                  ? ` A sobra de ${formatCurrency(order.financialSummary.surplusCreditGrantedAmount, order.currency)} foi creditada na carteira FlowPoints.`
                                  : ""}
                              </p>
                            </div>
                          ) : null}

                          <div className="grid gap-[24px] md:grid-cols-2 lg:grid-cols-3">
                            <div className="space-y-[16px]">
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Produto</p>
                                <p className="mt-[4px] text-[15px] font-semibold text-[#D1D1D1]">Licença Flowdesk</p>
                              </div>
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Servidor</p>
                                <p className="mt-[4px] text-[15px] font-semibold text-[#D1D1D1] font-mono">{order.guildId}</p>
                              </div>
                            </div>

                            <div className="space-y-[16px]">
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Data do Pedido</p>
                                <p className="mt-[4px] text-[15px] font-semibold text-[#D1D1D1]">{formatDate(order.createdAt)}</p>
                              </div>
                              {order.expiresAt && (
                                <div>
                                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Expiração</p>
                                  <p className="mt-[4px] text-[15px] font-semibold text-[#D1D1D1]">{formatDate(order.expiresAt)}</p>
                                </div>
                              )}
                            </div>

                            <div className="space-y-[16px]">
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Status</p>
                                <p className={`mt-[4px] text-[15px] font-semibold ${statusColor.split(' ')[0]}`}>{statusLabel}</p>
                              </div>
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">Valor Total</p>
                                <p className="mt-[4px] text-[15px] font-semibold text-[#D1D1D1]">{formatCurrency(order.amount, order.currency)}</p>
                              </div>
                            </div>

                             <div className="flex flex-col justify-end">
                               <a 
                                 href="/support"
                                 className="flex items-center gap-[10px] rounded-[12px] bg-[rgba(255,255,255,0.05)] border border-[#222] px-[18px] py-[12px] text-[14px] font-bold text-white transition-all hover:bg-[rgba(255,255,255,0.08)] w-fit"
                               >
                                 <MessageSquare className="h-[18px] w-[18px] text-[#A0A0A0]" />
                                 Problemas com o pedido?
                              </a>
                            </div>
                          </div>

                          {buildFinancialRows(order).length > 0 ? (
                            <div className="mt-[22px] rounded-[16px] border border-[#171717] bg-[#0A0A0A] p-[16px]">
                              <p className="text-[11px] font-bold uppercase tracking-widest text-[#444]">
                                Composicao financeira
                              </p>
                              <div className="mt-[14px] space-y-[10px]">
                                {buildFinancialRows(order).map((row) => {
                                  const isPositive = row.amount > 0;
                                  return (
                                    <div
                                      key={row.label}
                                      className="flex items-center justify-between gap-[14px] text-[14px]"
                                    >
                                      <span className="text-[#BEBEBE]">{row.label}</span>
                                      <span
                                        className={
                                          isPositive
                                            ? "font-semibold text-[#81B8FF]"
                                            : "font-semibold text-[#0ECF9C]"
                                        }
                                      >
                                        {`${isPositive ? "+ " : "- "}${formatCurrency(Math.abs(row.amount), order.currency)}`}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
