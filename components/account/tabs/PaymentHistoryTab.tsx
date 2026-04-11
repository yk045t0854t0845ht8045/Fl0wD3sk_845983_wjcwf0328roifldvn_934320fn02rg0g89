"use client";

import { useEffect, useState } from "react";
import { History, CheckCircle2, XCircle, AlertCircle, QrCode, CreditCard } from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";

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
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(amount: number, currency: string) {
  if (amount === 0) return "Gratuito";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(amount);
}

function resolveMethodLabel(method: OrderMethod): { label: string; icon: React.ElementType } {
  if (method === "pix") return { label: "PIX", icon: QrCode };
  if (method === "card") return { label: "Cartão", icon: CreditCard };
  if (method === "trial") return { label: "Gratuito / Trial", icon: CheckCircle2 };
  return { label: method ?? "—", icon: CreditCard };
}

function resolveStatusDisplay(status: OrderStatus): { label: string; color: string; icon: React.ElementType } {
  if (status === "approved") return { label: "Aprovado", color: "text-[#34A853] bg-[rgba(52,168,83,0.10)]", icon: CheckCircle2 };
  if (status === "pending") return { label: "Pendente", color: "text-[#F2C823] bg-[rgba(242,200,35,0.10)]", icon: AlertCircle };
  return { label: "Falhou", color: "text-[#DB4646] bg-[rgba(219,70,70,0.10)]", icon: XCircle };
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

export function PaymentHistoryTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch("/api/auth/me/payments/history");
        const json = await res.json();
        if (json.ok) {
          setOrders(json.orders || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, []);

  if (loading) {
    return (
      <div className="flex h-[200px] items-center justify-center">
        <ButtonLoader size={24} />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="mt-[32px] flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] py-[40px] px-[20px] text-center">
        <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#111111]">
          <History className="text-[#888888] h-[24px] w-[24px]" />
        </div>
        <p className="mt-[16px] text-[15px] font-medium text-[#E5E5E5]">Nenhum pagamento registrado</p>
        <p className="mt-[4px] text-[14px] text-[#777777]">
          Transações geradas ao assinar um plano aparecerão aqui.
        </p>
      </div>
    );
  }

  const groups = groupOrdersByMonth(orders);

  return (
    <div className="mt-[32px] space-y-[24px]">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-[10px] text-[11px] uppercase tracking-[0.16em] text-[#555555] capitalize">
            {group.label}
          </p>
          <div className="space-y-[8px]">
            {group.orders.map((order) => {
              const { label: methodLabel, icon: MethodIcon } = resolveMethodLabel(order.method);
              const { label: statusLabel, color: statusColor, icon: StatusIcon } = resolveStatusDisplay(order.status);
              const isFree = order.amount === 0 || order.method === "trial";

              return (
                <div
                  key={order.id}
                  className="flex flex-col gap-[12px] rounded-[16px] border border-[#131313] bg-[#0A0A0A] p-[16px] sm:flex-row sm:items-center sm:justify-between transition hover:border-[#1C1C1C]"
                >
                  <div className="flex items-center gap-[14px]">
                    <div className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full ${
                      order.status === "approved"
                        ? "bg-[rgba(52,168,83,0.08)] text-[#34A853]"
                        : order.status === "pending"
                        ? "bg-[rgba(242,200,35,0.08)] text-[#F2C823]"
                        : "bg-[rgba(219,70,70,0.08)] text-[#DB4646]"
                    }`}>
                      <StatusIcon className="h-[20px] w-[20px]" />
                    </div>

                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-[#EEEEEE] tracking-tight">
                        Pedido #{order.orderNumber}
                      </p>
                      <p className="mt-[3px] text-[12px] text-[#636363]">
                        {formatDate(order.paidAt || order.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-[16px] sm:justify-end">
                    <div className="flex items-center gap-[6px] rounded-[8px] border border-[#1A1A1A] bg-[#101010] px-[10px] py-[5px]">
                      <MethodIcon className="h-[13px] w-[13px] text-[#888888]" />
                      <span className="text-[12px] font-medium text-[#888888]">{methodLabel}</span>
                    </div>

                    <span className={`rounded-[8px] px-[10px] py-[4px] text-[12px] font-medium ${statusColor}`}>
                      {statusLabel}
                    </span>

                    <p className={`min-w-[72px] text-right text-[16px] font-bold ${isFree ? "text-[#34A853]" : "text-[#EEEEEE]"}`}>
                      {formatCurrency(order.amount, order.currency)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
