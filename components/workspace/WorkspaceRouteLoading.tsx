import { ServerSettingsEditorSkeleton } from "@/components/servers/ServerSettingsEditorSkeleton";

type WorkspaceRouteLoadingVariant =
  | "dashboard"
  | "account"
  | "servers"
  | "server-settings";

type WorkspaceRouteLoadingProps = {
  variant: WorkspaceRouteLoadingVariant;
};

function SkeletonBar({
  width,
  height,
  className = "",
}: {
  width: number | string;
  height: number | string;
  className?: string;
}) {
  return (
    <div
      className={`flowdesk-shimmer rounded-[12px] bg-[#171717] ${className}`.trim()}
      style={{ width, height }}
    />
  );
}

function SkeletonNavRow({
  active = false,
  compact = false,
  indent = false,
}: {
  active?: boolean;
  compact?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-[12px] rounded-[14px] px-[12px] ${
        compact ? "py-[10px]" : "py-[11px]"
      } ${active ? "bg-[#171717]" : "bg-transparent"} ${
        indent ? "ml-[12px]" : ""
      }`.trim()}
    >
      <SkeletonBar
        width={compact ? 20 : 22}
        height={compact ? 20 : 22}
        className="rounded-[10px]"
      />
      <SkeletonBar
        width={compact ? "48%" : "58%"}
        height={compact ? 12 : 13}
        className="max-w-full rounded-full"
      />
      {!indent ? (
        <SkeletonBar
          width={14}
          height={14}
          className="ml-auto rounded-full"
        />
      ) : null}
    </div>
  );
}

function AccountSidebarSkeleton() {
  return (
    <div className="flex h-full flex-col px-[14px] pb-[14px] pt-[20px]">
      <div className="flex items-center gap-[10px] rounded-[16px] border border-[#141414] bg-[#080808] px-[14px] py-[12px]">
        <SkeletonBar width={18} height={18} className="rounded-full" />
        <SkeletonBar width="44%" height={14} className="max-w-full rounded-full" />
        <SkeletonBar
          width={28}
          height={28}
          className="ml-auto rounded-[9px]"
        />
      </div>

      <div className="mt-[14px] space-y-[4px]">
        <SkeletonNavRow />
      </div>

      <div className="mt-[14px] flex-1 overflow-hidden pr-[2px]">
        <div className="space-y-[12px]">
          {Array.from({ length: 4 }, (_, groupIndex) => (
            <div key={groupIndex}>
              <SkeletonNavRow active={groupIndex === 0} />
              <div className="mt-[6px] space-y-[4px] pl-[12px]">
                {Array.from({ length: groupIndex === 1 ? 3 : 2 }, (_, itemIndex) => (
                  <SkeletonNavRow
                    key={itemIndex}
                    compact
                    indent
                    active={groupIndex === 0 && itemIndex === 0}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-[14px]">
        <div className="flex items-center justify-between gap-[12px] rounded-[18px] border border-[#111111] bg-[#080808] px-[10px] py-[10px]">
          <div className="flex min-w-0 items-center gap-[10px]">
            <SkeletonBar width={38} height={38} className="rounded-full" />
            <div className="min-w-0 space-y-[6px]">
              <SkeletonBar width={116} height={12} className="rounded-full" />
              <SkeletonBar width={84} height={10} className="rounded-full" />
            </div>
          </div>
          <SkeletonBar width={28} height={28} className="rounded-[10px]" />
        </div>
      </div>
    </div>
  );
}

function WorkspaceSidebarSkeleton() {
  return (
    <div className="flex h-full flex-col px-[14px] py-[14px]">
      <div className="rounded-[18px] border border-[#111111] bg-[#080808] px-[10px] py-[10px]">
        <div className="flex items-center justify-between gap-[12px]">
          <div className="flex min-w-0 items-center gap-[10px]">
            <SkeletonBar width={34} height={34} className="rounded-full" />
            <div className="min-w-0 space-y-[6px]">
              <SkeletonBar width={132} height={12} className="rounded-full" />
              <SkeletonBar width={112} height={10} className="rounded-full" />
            </div>
          </div>
          <SkeletonBar width={28} height={28} className="rounded-[10px]" />
        </div>
      </div>

      <div className="mt-[14px] flex items-center gap-[10px] rounded-[16px] border border-[#141414] bg-[#080808] px-[14px] py-[12px]">
        <SkeletonBar width={18} height={18} className="rounded-full" />
        <SkeletonBar width="42%" height={14} className="max-w-full rounded-full" />
        <SkeletonBar width={30} height={28} className="ml-auto rounded-[9px]" />
      </div>

      <div className="mt-[14px] min-h-0 flex-1 overflow-hidden pr-[2px]">
        <div className="space-y-[4px]">
          <SkeletonNavRow active />
          <SkeletonNavRow />
        </div>

        <div className="mt-[12px]">
          <SkeletonNavRow />
          <div className="mt-[6px] space-y-[4px] pl-[12px]">
            <SkeletonNavRow compact indent />
            <SkeletonNavRow compact indent />
          </div>
        </div>

        <div className="mt-[12px] space-y-[4px]">
          <SkeletonNavRow />
          <SkeletonNavRow />
        </div>

        <div className="mt-[12px]">
          <SkeletonNavRow />
          <div className="mt-[6px] space-y-[4px] pl-[12px]">
            <SkeletonNavRow compact indent />
            <SkeletonNavRow compact indent />
            <SkeletonNavRow compact indent />
          </div>
        </div>
      </div>

      <div className="mt-[14px]">
        <div className="flex items-center justify-between gap-[12px] rounded-[18px] border border-[#111111] bg-[#080808] px-[10px] py-[10px]">
          <div className="flex min-w-0 items-center gap-[10px]">
            <SkeletonBar width={38} height={38} className="rounded-full" />
            <div className="min-w-0 space-y-[6px]">
              <SkeletonBar width={118} height={12} className="rounded-full" />
              <SkeletonBar width={88} height={10} className="rounded-full" />
            </div>
          </div>
          <SkeletonBar width={28} height={28} className="rounded-[10px]" />
        </div>
      </div>
    </div>
  );
}

export function DashboardContentSkeleton() {
  return (
    <div className="mt-[24px] space-y-[10px]">
      <SkeletonBar width="min(220px,48vw)" height={12} className="max-w-full rounded-full bg-[#111111]" />
      <SkeletonBar width="min(340px,64vw)" height={12} className="max-w-full rounded-full bg-[#101010]" />
    </div>
  );
}

function DashboardMainSkeleton() {
  return (
    <section className="min-w-0">
      <div className="flex flex-col gap-[14px] md:flex-row md:items-end md:justify-between">
        <div>
          <SkeletonBar width={108} height={34} className="rounded-full" />
          <SkeletonBar width="min(320px,72vw)" height={42} className="mt-[18px] max-w-full rounded-[18px]" />
          <SkeletonBar width="min(560px,82vw)" height={14} className="mt-[14px] max-w-full rounded-full" />
          <SkeletonBar width="min(460px,76vw)" height={14} className="mt-[10px] max-w-full rounded-full" />
        </div>
      </div>

      <DashboardContentSkeleton />
    </section>
  );
}

function AccountMainSkeleton() {
  return (
    <section className="min-w-0">
      <div className="flex flex-col gap-[14px] md:flex-row md:items-end md:justify-between">
        <div>
          <SkeletonBar width={116} height={34} className="rounded-full" />
          <SkeletonBar width="min(300px,72vw)" height={42} className="mt-[18px] max-w-full rounded-[18px]" />
          <SkeletonBar width="min(540px,82vw)" height={14} className="mt-[14px] max-w-full rounded-full" />
          <SkeletonBar width="min(420px,76vw)" height={14} className="mt-[10px] max-w-full rounded-full" />
        </div>
      </div>

      <div className="mt-[28px]">
        <div className="mb-[20px] rounded-[18px] border border-[#191919] bg-[#090909] px-[20px] py-[18px]">
          <div className="flex items-start gap-[16px]">
            <SkeletonBar width={22} height={22} className="mt-[2px] rounded-full" />
            <div className="min-w-0 flex-1 space-y-[8px]">
              <SkeletonBar width={148} height={14} className="rounded-full" />
              <SkeletonBar width="86%" height={12} className="max-w-full rounded-full" />
              <SkeletonBar width="68%" height={12} className="max-w-full rounded-full" />
            </div>
          </div>
        </div>

        <div className="grid gap-[12px] md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="rounded-[20px] border border-[#141414] bg-[#0A0A0A] p-[18px]"
            >
              <SkeletonBar width={96} height={12} className="rounded-full" />
              <SkeletonBar width={72} height={24} className="mt-[16px] rounded-[14px]" />
              <SkeletonBar width="62%" height={12} className="mt-[10px] max-w-full rounded-full" />
            </div>
          ))}
        </div>

        <div className="mt-[18px] rounded-[24px] border border-[#141414] bg-[#090909] px-[20px] py-[20px]">
          <div className="space-y-[14px]">
            <SkeletonBar width="32%" height={16} className="max-w-full rounded-full" />
            <div className="grid gap-[12px] md:grid-cols-2">
              <SkeletonBar width="100%" height={120} className="rounded-[18px]" />
              <SkeletonBar width="100%" height={120} className="rounded-[18px]" />
            </div>
            <SkeletonBar width="100%" height={220} className="rounded-[22px]" />
          </div>
        </div>
      </div>
    </section>
  );
}

function ServersOverviewMainSkeleton() {
  return (
    <section className="min-w-0">
      <div className="relative z-[700] flex flex-col gap-[18px]">
        <div className="flex flex-col gap-[14px] md:flex-row md:items-end md:justify-between">
          <div>
            <SkeletonBar width={124} height={34} className="rounded-full" />
            <SkeletonBar width="min(340px,72vw)" height={42} className="mt-[18px] max-w-full rounded-[18px]" />
            <SkeletonBar width="min(560px,82vw)" height={14} className="mt-[14px] max-w-full rounded-full" />
            <SkeletonBar width="min(460px,76vw)" height={14} className="mt-[10px] max-w-full rounded-full" />
          </div>
          <SkeletonBar width={160} height={44} className="rounded-[14px]" />
        </div>

        <div className="rounded-[28px] border border-[#0E0E0E] bg-[#0A0A0A] px-[14px] py-[14px] shadow-[0_24px_80px_rgba(0,0,0,0.38)] sm:px-[18px] sm:py-[18px]">
          <div className="flex flex-col gap-[12px] xl:flex-row xl:items-center">
            <div className="flex min-w-0 flex-1 items-center rounded-[18px] border border-[#151515] bg-[#080808] px-[16px] py-[14px]">
              <SkeletonBar width={18} height={18} className="rounded-full" />
              <SkeletonBar width="36%" height={14} className="ml-[12px] max-w-full rounded-full" />
            </div>

            <div className="flex flex-wrap items-center gap-[10px] xl:justify-end">
              <SkeletonBar width={52} height={52} className="rounded-[16px]" />
              <div className="inline-flex items-center gap-[8px] rounded-[18px] border border-[#171717] bg-[#0D0D0D] p-[6px]">
                <SkeletonBar width={40} height={40} className="rounded-[12px]" />
                <SkeletonBar width={40} height={40} className="rounded-[12px]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-[22px] space-y-[14px]">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="rounded-[26px] border border-[#151515] bg-[#0A0A0A] p-[18px]"
          >
            <div className="flex flex-col gap-[18px] xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-[16px]">
                <SkeletonBar width={56} height={56} className="rounded-[16px]" />
                <div className="min-w-0 flex-1">
                  <SkeletonBar width="48%" height={18} className="max-w-full rounded-full" />
                  <SkeletonBar width="34%" height={12} className="mt-[10px] max-w-full rounded-full" />
                </div>
              </div>
              <div className="grid gap-[8px] xl:min-w-[240px]">
                <SkeletonBar width={138} height={16} className="rounded-full" />
                <SkeletonBar width={176} height={12} className="rounded-full" />
              </div>
              <div className="flex items-center gap-[12px]">
                <SkeletonBar width={108} height={34} className="rounded-full" />
                <SkeletonBar width={40} height={40} className="rounded-[14px]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ServerSettingsMainSkeleton() {
  return (
    <section className="min-w-0">
      <div className="relative z-[700] flex flex-col gap-[18px]">
        <div className="flex flex-col gap-[14px] md:flex-row md:items-end md:justify-between">
          <div className="space-y-[14px]" aria-hidden="true">
            <SkeletonBar width={146} height={42} className="rounded-full bg-[#111111]" />
            <SkeletonBar width="min(460px,78vw)" height={42} className="max-w-full rounded-[18px] bg-[#131313]" />
            <SkeletonBar width="min(620px,82vw)" height={14} className="max-w-full rounded-[12px] bg-[#111111]" />
          </div>
        </div>
      </div>

      <div className="mt-[22px]">
        <ServerSettingsEditorSkeleton standalone />
      </div>
    </section>
  );
}

function resolveWorkspaceMainSkeleton(variant: WorkspaceRouteLoadingVariant) {
  if (variant === "dashboard") {
    return <DashboardMainSkeleton />;
  }

  if (variant === "account") {
    return <AccountMainSkeleton />;
  }

  if (variant === "server-settings") {
    return <ServerSettingsMainSkeleton />;
  }

  return <ServersOverviewMainSkeleton />;
}

export function WorkspaceRouteContentLoading({
  variant,
}: WorkspaceRouteLoadingProps) {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]"
      />

      <main className="relative px-[20px] pt-[32px] pb-[56px] md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-[1220px]">
          {resolveWorkspaceMainSkeleton(variant)}
        </div>
      </main>
    </div>
  );
}

export function WorkspaceRouteLoading({
  variant,
}: WorkspaceRouteLoadingProps) {
  const isAccount = variant === "account";
  const sidebarShellClass = isAccount
    ? "border border-[#111111] bg-[#060606] flex flex-col overflow-hidden"
    : "relative overflow-hidden border border-[#0E0E0E] bg-[#050505] shadow-[0_24px_80px_rgba(0,0,0,0.42)]";
  const desktopSidebarVisibilityClass = isAccount ? "hidden xl:block" : "hidden lg:block";
  const mobileSidebarVisibilityClass = isAccount ? "mb-[20px] min-w-0 xl:hidden" : "mb-[20px] min-w-0 lg:hidden";
  const mainShellClass = isAccount
    ? "relative px-[20px] pt-[32px] pb-[56px] md:px-6 lg:px-8 xl:min-h-screen xl:pl-[358px] xl:pr-[42px]"
    : "relative px-[20px] pt-[32px] pb-[56px] md:px-6 lg:min-h-screen lg:pl-[358px] lg:pr-[42px]";

  const mainContent = resolveWorkspaceMainSkeleton(variant);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]"
      />

      <div className={desktopSidebarVisibilityClass}>
        <aside className="fixed inset-y-0 left-0 z-20 w-[318px]">
          <div
            className={`${sidebarShellClass} h-full rounded-none border-y-0 border-l-0 ${
              isAccount ? "border-r-[#151515]" : "border-r-[#151515]"
            }`}
          >
            {isAccount ? <AccountSidebarSkeleton /> : <WorkspaceSidebarSkeleton />}
          </div>
        </aside>
      </div>

      <main className={mainShellClass}>
        <div className="mx-auto w-full max-w-[1220px]">
          <aside className={mobileSidebarVisibilityClass}>
            <div className={`${sidebarShellClass} rounded-[28px]`}>
              {isAccount ? <AccountSidebarSkeleton /> : <WorkspaceSidebarSkeleton />}
            </div>
          </aside>

          {mainContent}
        </div>
      </main>
    </div>
  );
}
