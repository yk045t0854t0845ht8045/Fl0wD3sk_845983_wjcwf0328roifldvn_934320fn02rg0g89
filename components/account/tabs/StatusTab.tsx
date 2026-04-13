import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, X, ShieldAlert, ArrowRight } from "lucide-react";
import { useAccountStatus } from "@/hooks/useAccountData";
import { motion, AnimatePresence } from "motion/react";

type ViolationCategory = {
  id: string;
  name: string;
  description: string;
  ruleUrl: string | null;
};

type Violation = {
  id: string;
  type: string;
  category: ViolationCategory | null;
  reason: string | null;
  createdAt: string;
  expired: boolean;
};

// Utilities for date formatting
function formatTimeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "Agora mesmo";
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `Há ${diffInMinutes} min`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `Há ${diffInHours} horas`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 30) return `Há ${diffInDays} dias`;
  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) return `Há ${diffInMonths} meses`;
  const diffInYears = Math.floor(diffInMonths / 12);
  return `Há ${diffInYears} anos`;
}

function ViolationDetailModal({
  violation,
  onClose
}: {
  violation: Violation;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const categoryName = violation.category?.name || violation.type;
  const ruleUrl = violation.category?.ruleUrl || "https://flwdesk.com/privacy";

  // Friendly date formatting (Discord-style)
  const formatDateFriendly = (dateString: string) => {
    const d = new Date(dateString);
    return d.toLocaleDateString("pt-BR", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  };

  const createdAtFriendly = formatDateFriendly(violation.createdAt);

  // For violations, we can assume impact until expiry or a long time if permanent
  const impactDateFriendly = violation.expired ? "Expirada" : "por tempo indeterminado";

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2600] isolate flex items-center justify-center p-4">
      {/* Overlay matched to Security/Logs style */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(0,0,0,0.84)] backdrop-blur-[7px]"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 14 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        className="flowdesk-stage-fade relative w-full max-w-[800px] overflow-hidden rounded-[32px] bg-transparent shadow-[0_34px_110px_rgba(0,0,0,0.52)]"
      >
        {/* Premium Border Effects (same as security log modal) */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[32px] border border-[#0E0E0E]" />
        <span aria-hidden="true" className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[32px]" />
        <span aria-hidden="true" className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[32px]" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-[31px] bg-[linear-gradient(180deg,rgba(8,8,8,0.985)_0%,rgba(4,4,4,0.985)_100%)]" />

        <div className="relative z-10 px-[24px] py-[32px] sm:px-[36px] sm:py-[40px]">
          {/* Header Section */}
          <div className="flex items-start justify-between">
            <h2 className="text-[24px] font-normal tracking-[-0.04em] text-white leading-tight sm:text-[30px]">
              Você infringiu as regras da Flowdesk para <span className="font-bold text-[#E5E5E5]">{categoryName.toLowerCase()}</span>
            </h2>
            <button
              onClick={onClose}
              className="ml-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mt-8 space-y-9">
            {/* Section: O QUE ISSO SIGNIFICA */}
            <div>
              <h4 className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#5F5F5F]">O que isso significa para você</h4>
              <ul className="mt-[16px] space-y-[14px]">
                <li className="flex items-start gap-3 text-[16px] leading-[1.6] text-[#BBBBBB]">
                  <span className="mt-[11px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#5F5F5F]" />
                  <span>Seu acesso a certas ferramentas está limitado até {createdAtFriendly}.</span>
                </li>
                <li className="flex items-start gap-3 text-[16px] leading-[1.6] text-[#BBBBBB]">
                  <span className="mt-[11px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#5F5F5F]" />
                  <span>As violações afetarão o status da sua conta até {impactDateFriendly}.</span>
                </li>
              </ul>
            </div>

            {/* Section: O QUE VOCÊ PODE FAZER */}
            <div>
              <h4 className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#5F5F5F]">O que você pode fazer</h4>
              <p className="mt-[16px] text-[16px] leading-[1.6] text-[#BBBBBB]">
                Para manter sua conta em bom estado, familiarize-se com nossos <a href="https://flwdesk.com/terms" target="_blank" className="text-[#0062FF] hover:underline font-medium">Termos de Serviço</a> e <a href="https://flwdesk.com/privacy" target="_blank" className="text-[#0062FF] hover:underline font-medium">Diretrizes da Comunidade</a>.
              </p>
            </div>

            {/* Action Card: Aprenda sobre a política */}
            <a
              href={ruleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-[22px] border border-[#161616] bg-[#090909] p-[20px] transition-all hover:bg-[#0D0D0D] hover:border-[#242424]"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-[48px] w-[48px] items-center justify-center rounded-[14px] bg-[#111111] text-[#0062FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                  <ShieldAlert size={24} />
                </div>
                <p className="text-[16px] font-medium text-[#E0E0E0]">Aprenda sobre nossa política de {categoryName.toLowerCase()}.</p>
              </div>
              <ArrowRight size={20} className="text-[#444] transition-transform group-hover:translate-x-1 group-hover:text-[#888]" />
            </a>
          </div>

          {/* Footer Link */}
          <div className="mt-12 text-center">
            <p className="text-[14px] text-[#5F5F5F]">
              Cometemos um erro? <a href="https://flwdesk.com/support" target="_blank" className="text-[#0062FF] hover:underline font-medium">Avise-nos</a>
            </p>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

export function StatusTab({
  displayName,
  avatarUrl,
}: {
  displayName: string;
  avatarUrl: string | null;
}) {
  const { statusData, loading } = useAccountStatus();

  const [activeViolationsOpen, setActiveViolationsOpen] = useState(true);
  const [expiredViolationsOpen, setExpiredViolationsOpen] = useState(false);
  const [selectedViolation, setSelectedViolation] = useState<Violation | null>(null);

  // Derive counts from data
  const activeViolations: Violation[] = statusData?.activeViolations || [];
  const expiredViolations: Violation[] = statusData?.expiredViolations || [];

  const activeCount = activeViolations.length;
  const expiredCount = expiredViolations.length;

  const currentLevel = statusData?.statusLevel ?? 0;
  const statusLabel = statusData?.status || "Tudo certo!";

  const statusColor = currentLevel === 0
    ? "text-[#10B981]"
    : currentLevel >= 4
      ? "text-[#DB4646]"
      : "text-[#E7A540]";

  const steps = [
    { label: "Tudo certo!", active: currentLevel >= 0, isCurrent: currentLevel === 0, color: "text-[#10B981]", bg: "bg-[#10B981]" },
    { label: "Limitado", active: currentLevel >= 1, isCurrent: currentLevel === 1, color: "text-[#E7A540]", bg: "bg-[#E7A540]" },
    { label: "Muito limitado", active: currentLevel >= 2, isCurrent: currentLevel === 2, color: "text-[#E7A540]", bg: "bg-[#E7A540]" },
    { label: "Em risco", active: currentLevel >= 3, isCurrent: currentLevel === 3, color: "text-[#DB4646]", bg: "bg-[#DB4646]" },
    { label: "Suspenso", active: currentLevel >= 4, isCurrent: currentLevel === 4, color: "text-[#DB4646]", bg: "bg-[#DB4646]" },
  ];

  if (loading) {
    return (
      <div className="space-y-[24px]">
        {/* Header Skeleton */}
        <div className="flowdesk-shimmer h-[260px] md:h-[220px] w-full rounded-[20px] border border-[#141414] bg-[#0A0A0A]" />

        {/* Accordions Skeleton */}
        <div className="space-y-[16px]">
          <div className="flowdesk-shimmer h-[82px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]" />
          <div className="flowdesk-shimmer h-[82px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-[24px]">

      {/* Header Profile & Status */}
      <div className="flex flex-col md:flex-row items-center md:items-start gap-[24px] rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[24px] md:p-[32px]">
        {/* Avatar Area */}
        <div className="shrink-0 relative">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt="Avatar"
              width={96}
              height={96}
              className="rounded-full border-[3px] border-[#111111] relative z-10 shadow-lg object-cover"
            />
          ) : (
            <div className="flex h-[96px] w-[96px] items-center justify-center rounded-full bg-[#111] text-[32px] font-bold text-[#444] border-[3px] border-[#111111] relative z-10 shadow-lg">
              {displayName.charAt(0) || "?"}
            </div>
          )}
        </div>

        {/* Text Area */}
        <div className="flex-1 text-center md:text-left mt-[10px] md:mt-0">
          <h2 className="text-[24px] font-medium tracking-[-0.02em] text-white">
            Sua conta está <span className={`${statusColor} font-semibold transition-colors`}>{statusLabel.toLowerCase()}</span>
          </h2>
          <p className="mt-[12px] text-[15px] leading-[1.6] text-[#A0A0A0]">
            Obrigado por respeitar os Termos de Serviço e as diretrizes da comunidade
            Flowdesk. Se você infringir as regras, isso será exibido aqui e impactará seu status.
          </p>

          {/* Status Timeline Bar */}
          <div className="mt-[36px] w-full max-w-[700px] mb-[10px]">
            <div className="relative flex items-center justify-between">
              {/* Connecting Line Backdrop */}
              <div className="absolute left-[5%] right-[5%] top-[14px] h-[3px] -translate-y-1/2 bg-[#222222] z-0 rounded-full" />

              {steps.map((step, idx) => (
                <div key={idx} className="relative z-10 flex flex-col items-center gap-[12px] w-[80px]">
                  {step.active ? (
                    <div className={`flex h-[28px] w-[28px] items-center justify-center rounded-full ${step.bg} shadow-[0_0_15px_rgba(0,0,0,0.3)]`}>
                      <CheckCircle2 className="h-[18px] w-[18px] text-white" strokeWidth={2.5} />
                    </div>
                  ) : (
                    <div className={`h-[20px] w-[20px] mt-[4px] rounded-full border-[4px] border-[#0A0A0A] bg-[#222222]`} />
                  )}
                  <span className={`text-[13px] font-medium text-center whitespace-nowrap ${step.active ? step.color : "text-[#777777]"} ${step.isCurrent ? "brightness-125" : ""}`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Accordions */}
      <div className="space-y-[16px]">

        {/* Active Violations Accordion */}
        <div className="rounded-[18px] border border-[#141414] bg-[#0A0A0A] overflow-hidden transition-all duration-300">
          <button
            type="button"
            onClick={() => setActiveViolationsOpen((p) => !p)}
            className="flex w-full items-center justify-between p-[20px] hover:bg-[#0E0E0E] transition-colors focus:outline-none"
          >
            <div className="flex items-center gap-[16px]">
              <div className={`flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#1A1A1A] text-[#E0E0E0]`}>
                <AlertTriangle className="h-[20px] w-[20px]" />
              </div>
              <div className="text-left">
                <h3 className="text-[16px] font-semibold text-[#E9E9E9]">
                  Violações em vigor — {activeCount}
                </h3>
                <p className="mt-[2px] text-[13px] text-[#7A7A7A]">
                  Isso afeta o status da sua conta até que expirem.
                </p>
              </div>
            </div>
            <div className="text-[#6E6E6E]">
              {activeViolationsOpen ? <ChevronUp className="h-[20px] w-[20px]" /> : <ChevronDown className="h-[20px] w-[20px]" />}
            </div>
          </button>

          {activeViolationsOpen && (
            <div className="px-[20px] pb-[20px]">
              {activeCount > 0 ? (
                <div className="flex flex-col gap-[12px]">
                  {activeViolations.map((v) => {
                    const displayName = v.category?.name || v.type;

                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedViolation(v)}
                        className="group w-full text-left rounded-[14px] bg-[#141414] border border-[#1C1C1C] p-[20px] transition-all hover:bg-[#1A1A1A] hover:border-[#222] active:scale-[0.99]"
                      >
                        <div className="flex items-center justify-between mb-[12px]">
                          <div className="inline-flex items-center rounded-full bg-[#1E1E1E] px-[12px] py-[4px] text-[12px] font-medium text-[#777] border border-[#262626]">
                            {formatTimeAgo(v.createdAt)}
                          </div>
                          <div className="text-[#444] group-hover:text-[#888] transition-colors">
                            <ArrowRight className="h-4 w-4" />
                          </div>
                        </div>
                        <p className="text-[17px] text-[#E5E5E5] font-medium tracking-tight">
                          Violação de <span className="text-white font-bold">{displayName}</span> detectada.
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[14px] bg-[#111111] border border-[#1A1A1A] p-[20px] text-center">
                  <p className="text-[14px] text-[#888888]">Nenhuma violação em vigor.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Expired Violations Accordion */}
        <div className="rounded-[18px] border border-[#141414] bg-[#0A0A0A] overflow-hidden transition-all duration-300">
          <button
            type="button"
            onClick={() => setExpiredViolationsOpen((p) => !p)}
            className="flex w-full items-center justify-between p-[20px] hover:bg-[#0E0E0E] transition-colors focus:outline-none"
          >
            <div className="flex items-center gap-[16px]">
              <div className={`flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#151515] text-[#888888]`}>
                <AlertTriangle className="h-[20px] w-[20px]" />
              </div>
              <div className="text-left">
                <h3 className="text-[16px] font-semibold text-[#A9A9A9]">
                  Violações expiradas — {expiredCount}
                </h3>
                <p className="mt-[2px] text-[13px] text-[#6A6A6A]">
                  Estas não afetam mais o status da sua conta.
                </p>
              </div>
            </div>
            <div className="text-[#5E5E5E]">
              {expiredViolationsOpen ? <ChevronUp className="h-[20px] w-[20px]" /> : <ChevronDown className="h-[20px] w-[20px]" />}
            </div>
          </button>

          {expiredViolationsOpen && (
            <div className="px-[20px] pb-[20px]">
              {expiredCount > 0 ? (
                <div className="flex flex-col gap-[12px]">
                  {expiredViolations.map((v) => {
                    const displayName = v.category?.name || v.type;

                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedViolation(v)}
                        className="group w-full text-left rounded-[14px] bg-[#111111] border border-[#181818] p-[20px] opacity-70 transition-all hover:opacity-100 hover:bg-[#151515] active:scale-[0.99]"
                      >
                        <div className="flex items-center justify-between mb-[12px]">
                          <div className="inline-flex items-center rounded-full bg-[#1E1E1E] px-[12px] py-[4px] text-[12px] font-medium text-[#666]">
                            {formatTimeAgo(v.createdAt)}
                          </div>
                          <div className="text-[#333] group-hover:text-[#666]">
                            <ArrowRight className="h-4 w-4" />
                          </div>
                        </div>
                        <p className="text-[16px] text-[#A0A0A0] font-medium">
                          Violação de <span className="font-bold text-[#C0C0C0]">{displayName}</span> (expirada)
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[14px] bg-[#111111] border border-[#161616] p-[20px] text-center">
                  <p className="text-[14px] text-[#707070]">Nenhuma violação expirada encontrada.</p>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Global Violation Modal */}
      <AnimatePresence>
        {selectedViolation && (
          <ViolationDetailModal
            violation={selectedViolation}
            onClose={() => setSelectedViolation(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
