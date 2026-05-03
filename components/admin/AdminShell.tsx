"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { buildBrowserRoutingTargetFromInternalPath } from "@/lib/routing/subdomains";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopbar } from "@/components/admin/AdminTopbar";

export type AdminShellProfile = {
  displayName: string;
  email: string | null;
  primaryRole: string | null;
  permissionCount: number;
  permissions: string[];
};

type AdminShellProps = {
  profile: AdminShellProfile;
  children: React.ReactNode;
};

export function AdminShell({
  profile,
  children,
}: AdminShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [, startNavigationTransition] = useTransition();

  const navigateTo = useCallback(
    (href: string) => {
      const target = buildBrowserRoutingTargetFromInternalPath(href, {
        fallbackArea: "admin",
      });

      setIsSidebarOpen(false);

      if (target.sameOrigin) {
        startNavigationTransition(() => {
          router.push(target.path);
        });
        return;
      }

      window.location.assign(target.href);
    },
    [router],
  );

  const prefetchTo = useCallback(
    (href: string) => {
      const target = buildBrowserRoutingTargetFromInternalPath(href, {
        fallbackArea: "admin",
      });

      if (target.sameOrigin) {
        void router.prefetch(target.path);
      }
    },
    [router],
  );

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ forgetTrustedDevice: false }),
      });
    } catch {
      // Mesmo se o endpoint falhar, ainda seguimos para a tela de login.
    }

    navigateTo("/login");
  }, [navigateTo]);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]"
      />

      <div className="hidden xl:block">
        <aside className="fixed inset-y-0 left-0 z-20 w-[318px]">
          <div className="relative h-full overflow-hidden border-r border-[#151515] bg-[#050505] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
            <AdminSidebar
              currentPath={pathname}
              profile={profile}
              onNavigate={navigateTo}
              onPrefetch={prefetchTo}
              onLogout={() => {
                void handleLogout();
              }}
            />
          </div>
        </aside>
      </div>

      {isSidebarOpen ? (
        <div className="fixed inset-0 z-[1300] xl:hidden">
          <button
            type="button"
            aria-label="Fechar menu administrativo"
            className="absolute inset-0 bg-[rgba(0,0,0,0.72)]"
            onClick={() => setIsSidebarOpen(false)}
          />
          <aside className="relative h-full w-[min(318px,92vw)] overflow-hidden border-r border-[#151515] bg-[#050505] shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="absolute right-[14px] top-[14px] z-10 inline-flex h-[38px] w-[38px] items-center justify-center rounded-[14px] border border-[#181818] bg-[#0F0F0F] text-[#D8D8D8]"
              aria-label="Fechar navegacao administrativa"
            >
              <X className="h-[16px] w-[16px]" strokeWidth={1.9} />
            </button>
            <AdminSidebar
              currentPath={pathname}
              profile={profile}
              onNavigate={navigateTo}
              onPrefetch={prefetchTo}
              onLogout={() => {
                void handleLogout();
              }}
            />
          </aside>
        </div>
      ) : null}

      <main className="relative px-[20px] pb-[56px] pt-[32px] md:px-6 xl:min-h-screen xl:pl-[358px] xl:pr-[42px]">
        <div className="mx-auto w-full max-w-[1220px]">
          <AdminTopbar
            currentPath={pathname}
            primaryRole={profile.primaryRole}
            permissionCount={profile.permissionCount}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            onOpenDashboard={() => navigateTo("/dashboard")}
            onOpenAccount={() => navigateTo("/account")}
            onLogout={() => {
              void handleLogout();
            }}
          />
          {children}
        </div>
      </main>
    </div>
  );
}
