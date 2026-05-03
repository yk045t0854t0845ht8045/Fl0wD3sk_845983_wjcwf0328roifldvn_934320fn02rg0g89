"use client";

import {
  ArrowLeftRight,
  LogOut,
  Menu,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { resolveAdminPageMeta } from "@/lib/admin/navigation";

type AdminTopbarProps = {
  currentPath: string;
  primaryRole: string | null;
  permissionCount: number;
  onOpenSidebar: () => void;
  onOpenDashboard: () => void;
  onOpenAccount: () => void;
  onLogout: () => void;
};

function TopbarActionButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-[10px] rounded-[14px] border border-[#181818] bg-[#0F0F0F] px-[14px] py-[11px] text-[13px] font-medium text-[#C7C7C7] transition-colors hover:border-[#242424] hover:bg-[#121212] hover:text-[#ECECEC]"
    >
      {icon}
      {label}
    </button>
  );
}

export function AdminTopbar({
  currentPath,
  primaryRole,
  permissionCount,
  onOpenSidebar,
  onOpenDashboard,
  onOpenAccount,
  onLogout,
}: AdminTopbarProps) {
  const meta = resolveAdminPageMeta(currentPath);

  return (
    <div className="mb-[24px] rounded-[24px] border border-[#141414] bg-[#090909] px-[18px] py-[16px] shadow-[0_18px_56px_rgba(0,0,0,0.22)]">
      <div className="flex flex-col gap-[16px] xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-[10px]">
            <button
              type="button"
              onClick={onOpenSidebar}
              className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-[#191919] bg-[#0F0F0F] text-[#D5D5D5] xl:hidden"
              aria-label="Abrir navegacao administrativa"
            >
              <Menu className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </button>

            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#616161]">
                {meta.eyebrow}
              </p>
              <h2 className="mt-[8px] text-[24px] leading-none font-medium tracking-[-0.04em] text-[#F2F2F2]">
                {meta.title}
              </h2>
            </div>
          </div>

          <p className="mt-[12px] max-w-[760px] text-[13px] leading-[1.7] text-[#737373]">
            {meta.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-[10px] xl:justify-end">
          <div className="inline-flex items-center gap-[8px] rounded-full border border-[#1A1A1A] bg-[#0F0F0F] px-[12px] py-[8px] text-[12px] text-[#AFAFAF]">
            <ShieldCheck className="h-[14px] w-[14px]" strokeWidth={1.9} />
            <span>{primaryRole || "Staff Flowdesk"}</span>
          </div>
          <div className="inline-flex items-center gap-[8px] rounded-full border border-[#1A1A1A] bg-[#0F0F0F] px-[12px] py-[8px] text-[12px] text-[#AFAFAF]">
            <ArrowLeftRight className="h-[14px] w-[14px]" strokeWidth={1.9} />
            <span>{permissionCount} permissoes efetivas</span>
          </div>
          <TopbarActionButton
            label="Dashboard"
            onClick={onOpenDashboard}
            icon={<ArrowLeftRight className="h-[14px] w-[14px]" strokeWidth={1.9} />}
          />
          <TopbarActionButton
            label="Minha conta"
            onClick={onOpenAccount}
            icon={<UserRound className="h-[14px] w-[14px]" strokeWidth={1.9} />}
          />
          <TopbarActionButton
            label="Sair"
            onClick={onLogout}
            icon={<LogOut className="h-[14px] w-[14px]" strokeWidth={1.9} />}
          />
        </div>
      </div>
    </div>
  );
}
