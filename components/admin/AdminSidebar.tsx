"use client";

import {
  Boxes,
  CreditCard,
  Globe,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  ReceiptText,
  Server,
  Settings2,
  Shield,
  Sparkles,
  Ticket,
  Users,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { LandingGlowTag } from "@/components/landing/LandingGlowTag";
import { ADMIN_NAV_SECTIONS, type AdminNavIconKey } from "@/lib/admin/navigation";

type AdminSidebarProfile = {
  displayName: string;
  email: string | null;
  primaryRole: string | null;
  permissions: string[];
};

type AdminSidebarProps = {
  currentPath: string;
  profile: AdminSidebarProfile;
  onNavigate: (href: string) => void;
  onPrefetch: (href: string) => void;
  onLogout: () => void;
};

const ADMIN_ICON_MAP: Record<AdminNavIconKey, LucideIcon> = {
  overview: LayoutDashboard,
  team: Users,
  roles: UserRound,
  permissions: KeyRound,
  users: Users,
  servers: Server,
  domains: Globe,
  hosting: HardDrive,
  payments: CreditCard,
  billing: ReceiptText,
  support: Ticket,
  status: Boxes,
  security: Shield,
  flowai: Sparkles,
  testVariables: LockKeyhole,
  audit: Shield,
  settings: Settings2,
};

function getUserInitial(displayName: string) {
  const normalized = displayName.trim();
  return normalized ? normalized.charAt(0).toUpperCase() : "F";
}

function normalizeComparablePath(pathname: string) {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function AdminSidebar({
  currentPath,
  profile,
  onNavigate,
  onPrefetch,
  onLogout,
}: AdminSidebarProps) {
  const normalizedCurrentPath = normalizeComparablePath(currentPath);

  return (
    <div className="flex h-full flex-col px-[14px] pb-[14px] pt-[20px]">
      <div className="rounded-[20px] border border-[#111111] bg-[#080808] px-[14px] py-[14px]">
        <div className="flex items-center justify-between gap-[12px]">
          <div className="min-w-0">
            <LandingGlowTag className="px-[18px]">Admin</LandingGlowTag>
            <p className="mt-[12px] text-[20px] leading-none font-medium tracking-[-0.04em] text-[#EFEFEF]">
              Flowdesk
            </p>
            <p className="mt-[8px] text-[12px] leading-[1.6] text-[#6F6F6F]">
              Camada institucional com RBAC, auditoria e operacao interna.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-[14px] min-h-0 flex-1 overflow-y-auto pr-[2px]">
        <div className="space-y-[18px]">
          {ADMIN_NAV_SECTIONS.map((section) => (
            <section key={section.id}>
              <p className="px-[12px] text-[11px] font-medium uppercase tracking-[0.18em] text-[#5D5D5D]">
                {section.label}
              </p>

              <div className="mt-[8px] space-y-[4px]">
                {section.items.map((item) => {
                  const Icon = ADMIN_ICON_MAP[item.icon];
                  const isActive =
                    normalizedCurrentPath === item.href ||
                    (item.href !== "/admin" &&
                      normalizedCurrentPath.startsWith(`${item.href}/`));
                  const isAllowed = profile.permissions.includes(item.permission);
                  const isDisabled = !isAllowed || item.status !== "active";

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (isDisabled) {
                          return;
                        }
                        onNavigate(item.href);
                      }}
                      onMouseEnter={() => {
                        if (!isDisabled) {
                          onPrefetch(item.href);
                        }
                      }}
                      onFocus={() => {
                        if (!isDisabled) {
                          onPrefetch(item.href);
                        }
                      }}
                      className={`flex w-full items-center gap-[12px] rounded-[16px] border px-[14px] py-[12px] text-left transition-colors ${
                        isActive
                          ? "border-[#1E1E1E] bg-[#111111] text-[#F3F3F3]"
                          : isDisabled
                            ? "border-transparent bg-transparent text-[#565656]"
                            : "border-transparent bg-transparent text-[#BFBFBF] hover:border-[#171717] hover:bg-[#0D0D0D] hover:text-[#E7E7E7]"
                      }`.trim()}
                      disabled={isDisabled}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.85} />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                        {item.label}
                      </span>
                      {item.badge ? (
                        <span className="rounded-full border border-[#1A1A1A] bg-[#101010] px-[8px] py-[4px] text-[10px] uppercase tracking-[0.14em] text-[#808080]">
                          {item.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="mt-[14px] rounded-[20px] border border-[#111111] bg-[#080808] px-[12px] py-[12px]">
        <div className="flex items-start gap-[12px]">
          <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,#B5B5B5_0%,#666666_45%,#1A1A1A_100%)] text-[16px] font-semibold text-[#111111]">
            {getUserInitial(profile.displayName)}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-[#ECECEC]">
              {profile.displayName}
            </p>
            <p className="mt-[4px] truncate text-[12px] text-[#787878]">
              {profile.primaryRole || "Staff Flowdesk"}
            </p>
            {profile.email ? (
              <p className="mt-[4px] truncate text-[12px] text-[#5E5E5E]">
                {profile.email}
              </p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="mt-[12px] flex w-full items-center justify-center rounded-[14px] border border-[#181818] bg-[#101010] px-[14px] py-[11px] text-[13px] font-medium text-[#C7C7C7] transition-colors hover:border-[#222222] hover:bg-[#121212]"
        >
          Encerrar sessao
        </button>
      </div>
    </div>
  );
}
