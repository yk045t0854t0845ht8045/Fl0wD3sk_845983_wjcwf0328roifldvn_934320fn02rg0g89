import type { ReactNode } from "react";
import { serversScale } from "@/components/servers/serversScale";

export type ServerSettingsSkeletonTab =
  | "settings"
  | "payments"
  | "methods"
  | "plans";

export type ServerSettingsSkeletonSection =
  | "overview"
  | "message"
  | "sales_overview"
  | "sales_categories"
  | "sales_products"
  | "sales_payment_methods"
  | "sales_coupons_gifts"
  | "entry_exit_overview"
  | "entry_exit_message"
  | "security_antilink"
  | "security_autorole"
  | "security_logs"
  | "ticket_ai";

type ServerSettingsEditorSkeletonProps = {
  standalone?: boolean;
  tab?: ServerSettingsSkeletonTab;
  settingsSection?: ServerSettingsSkeletonSection | null;
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

function SkeletonCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[24px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[18px] py-[18px] sm:px-[22px] sm:py-[22px] ${className}`.trim()}
    >
      {children}
    </div>
  );
}

function SkeletonChip({
  width,
  className = "",
}: {
  width: number | string;
  className?: string;
}) {
  return (
    <SkeletonBar
      width={width}
      height={30}
      className={`rounded-full ${className}`.trim()}
    />
  );
}

function SkeletonToggle() {
  return (
    <div className="inline-flex h-[34px] w-[66px] items-center rounded-full border border-[#181818] bg-[#0C0C0C] px-[4px]">
      <SkeletonBar width={26} height={26} className="rounded-full bg-[#1D1D1D]" />
    </div>
  );
}

function SkeletonIconButton({
  size = 44,
}: {
  size?: number;
}) {
  return (
    <SkeletonBar
      width={size}
      height={size}
      className="rounded-[14px] bg-[#101010]"
    />
  );
}

function SkeletonHeader({
  eyebrowWidth,
  titleWidth,
  descriptionWidths,
  action,
}: {
  eyebrowWidth: number | string;
  titleWidth: number | string;
  descriptionWidths: Array<number | string>;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[14px] lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <SkeletonBar width={eyebrowWidth} height={12} className="rounded-full bg-[#111111]" />
        <SkeletonBar width={titleWidth} height={24} className="mt-[10px] max-w-full rounded-[14px]" />
        <div className="mt-[10px] space-y-[8px]">
          {descriptionWidths.map((width, index) => (
            <SkeletonBar
              key={index}
              width={width}
              height={14}
              className="max-w-full rounded-full bg-[#111111]"
            />
          ))}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function SkeletonField({
  labelWidth = "44%",
  height = 58,
}: {
  labelWidth?: number | string;
  height?: number;
}) {
  return (
    <div className="flex flex-col gap-[8px]">
      <SkeletonBar width={labelWidth} height={12} className="rounded-full bg-[#111111]" />
      <SkeletonBar width="100%" height={height} className="rounded-[18px] bg-[#0A0A0A]" />
    </div>
  );
}

function SkeletonFieldGrid({
  count,
  columnsClass = "xl:grid-cols-2",
  heights = [],
}: {
  count: number;
  columnsClass?: string;
  heights?: number[];
}) {
  const labelWidths = ["44%", "52%", "38%", "48%", "34%", "41%"];
  return (
    <div className={`mt-[18px] grid grid-cols-1 gap-[16px] ${columnsClass}`.trim()}>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonField
          key={index}
          labelWidth={labelWidths[index % labelWidths.length]}
          height={heights[index] ?? 58}
        />
      ))}
    </div>
  );
}

function SkeletonEventRow() {
  return (
    <div className="rounded-[22px] border border-[#171717] bg-[linear-gradient(180deg,#0D0D0D_0%,#090909_100%)] px-[16px] py-[16px] sm:px-[18px] sm:py-[18px]">
      <div className="flex flex-col gap-[14px] xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-[12px]">
            <SkeletonBar width={42} height={42} className="shrink-0 rounded-[16px] bg-[#101010]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[8px]">
                <SkeletonBar width={148} height={16} className="rounded-full" />
                <SkeletonBar width={22} height={22} className="rounded-full bg-[#111111]" />
              </div>
              <div className="mt-[8px] space-y-[8px]">
                <SkeletonBar width="86%" height={13} className="max-w-full rounded-full bg-[#111111]" />
                <SkeletonBar width="68%" height={13} className="max-w-full rounded-full bg-[#111111]" />
              </div>
              <div className="mt-[12px] flex flex-wrap gap-[8px]">
                <SkeletonChip width={144} />
                <SkeletonChip width={110} className="bg-[#101010]" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-[10px]">
          <SkeletonIconButton />
          <SkeletonToggle />
        </div>
      </div>
    </div>
  );
}

function renderSettingsOverviewSkeleton() {
  return (
    <div className="space-y-[14px]">
      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={92}
          titleWidth="min(350px,68vw)"
          descriptionWidths={["min(620px,92%)", "min(500px,80%)"]}
          action={<SkeletonToggle />}
        />
      </SkeletonCard>

      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={56}
          titleWidth="min(280px,58vw)"
          descriptionWidths={["min(560px,88%)", "min(430px,74%)"]}
        />
        <SkeletonFieldGrid count={4} />
      </SkeletonCard>

      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={58}
          titleWidth="min(300px,62vw)"
          descriptionWidths={["min(540px,84%)", "min(460px,76%)"]}
          action={<SkeletonIconButton />}
        />
        <SkeletonFieldGrid count={4} />
      </SkeletonCard>
    </div>
  );
}

function renderTicketMessageSkeleton(showWelcomeTabs = false) {
  return (
    <div className="space-y-[14px]">
      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={showWelcomeTabs ? 168 : 118}
          titleWidth="min(340px,72vw)"
          descriptionWidths={["min(580px,90%)", "min(430px,74%)"]}
          action={
            <div className="flex flex-wrap items-center gap-[12px]">
              {showWelcomeTabs ? (
                <>
                  <div className="inline-flex items-center gap-[8px] rounded-full border border-[#151515] bg-[#0B0B0B] p-[4px]">
                    <SkeletonChip width={94} className="h-[34px]" />
                    <SkeletonChip width={82} className="h-[34px] bg-[#101010]" />
                  </div>
                  <div className="inline-flex items-center gap-[8px] rounded-full border border-[#151515] bg-[#0B0B0B] p-[4px]">
                    <SkeletonChip width={96} className="h-[34px]" />
                    <SkeletonChip width={96} className="h-[34px] bg-[#101010]" />
                  </div>
                </>
              ) : (
                <>
                  <SkeletonChip width={118} />
                  <SkeletonChip width={126} className="bg-[#101010]" />
                </>
              )}
              <SkeletonIconButton />
            </div>
          }
        />
      </SkeletonCard>

      <div className="grid grid-cols-1 gap-[14px] xl:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
        <SkeletonCard className="h-full">
          <div className="space-y-[14px]">
            <div className="rounded-[20px] border border-[#141414] bg-[#090909] p-[16px]">
              <div className="flex items-center justify-between gap-[10px]">
                <div className="space-y-[8px]">
                  <SkeletonBar width={112} height={12} className="rounded-full bg-[#111111]" />
                  <SkeletonBar width={168} height={10} className="rounded-full bg-[#111111]" />
                </div>
                <SkeletonChip width={88} className="h-[28px] bg-[#111111]" />
              </div>
              <SkeletonBar width="100%" height={224} className="mt-[16px] rounded-[22px] bg-[#0A0A0A]" />
            </div>

            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="rounded-[18px] border border-[#141414] bg-[#0A0A0A] px-[14px] py-[14px]"
                >
                  <SkeletonBar width={74} height={10} className="rounded-full bg-[#111111]" />
                  <SkeletonBar width="82%" height={12} className="mt-[12px] max-w-full rounded-full" />
                  <SkeletonBar width="64%" height={12} className="mt-[8px] max-w-full rounded-full bg-[#111111]" />
                </div>
              ))}
            </div>
          </div>
        </SkeletonCard>

        <div className="space-y-[14px]">
          <SkeletonCard>
            <SkeletonHeader
              eyebrowWidth={showWelcomeTabs ? 126 : 92}
              titleWidth="min(260px,52vw)"
              descriptionWidths={["min(440px,84%)"]}
            />
            <SkeletonFieldGrid count={3} heights={[62, 152, 62]} />
            <div className="mt-[18px] flex flex-wrap gap-[10px]">
              <SkeletonChip width={116} />
              <SkeletonChip width={102} className="bg-[#101010]" />
              <SkeletonChip width={92} className="bg-[#101010]" />
            </div>
          </SkeletonCard>

          <SkeletonCard>
            <SkeletonHeader
              eyebrowWidth={88}
              titleWidth="min(220px,44vw)"
              descriptionWidths={["min(420px,82%)"]}
            />
            <div className="mt-[18px] space-y-[10px]">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-[10px] rounded-[18px] border border-[#141414] bg-[#0A0A0A] px-[14px] py-[12px]"
                >
                  <div className="min-w-0 flex-1">
                    <SkeletonBar width={index % 2 === 0 ? "46%" : "58%"} height={12} className="max-w-full rounded-full" />
                    <SkeletonBar width={index % 2 === 0 ? "66%" : "52%"} height={10} className="mt-[8px] max-w-full rounded-full bg-[#111111]" />
                  </div>
                  <SkeletonIconButton size={38} />
                </div>
              ))}
            </div>
          </SkeletonCard>
        </div>
      </div>
    </div>
  );
}

function renderFlowAiSkeleton() {
  return (
    <div className="space-y-[14px]">
      <SkeletonCard>
        <div className="flex flex-col gap-[14px] lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <SkeletonChip width={154} className="bg-[rgba(0,98,255,0.08)]" />
            <SkeletonBar width="min(420px,78vw)" height={28} className="mt-[14px] max-w-full rounded-[16px]" />
            <div className="mt-[10px] space-y-[8px]">
              <SkeletonBar width="min(640px,94%)" height={14} className="max-w-full rounded-full bg-[#111111]" />
              <SkeletonBar width="min(520px,80%)" height={14} className="max-w-full rounded-full bg-[#111111]" />
            </div>
            <SkeletonBar width={194} height={12} className="mt-[12px] rounded-full bg-[#101010]" />
          </div>
          <SkeletonToggle />
        </div>
      </SkeletonCard>

      <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="rounded-[20px] border border-[#161616] bg-[linear-gradient(180deg,#0B0B0B_0%,#090909_100%)] px-[16px] py-[14px]"
          >
            <SkeletonBar width={index % 2 === 0 ? 104 : 88} height={11} className="rounded-full bg-[#111111]" />
            <SkeletonBar width={index % 2 === 0 ? 132 : 116} height={16} className="mt-[10px] rounded-[12px]" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
        <SkeletonCard>
          <SkeletonHeader
            eyebrowWidth={156}
            titleWidth="min(250px,48vw)"
            descriptionWidths={["min(420px,82%)", "min(360px,70%)"]}
          />
          <SkeletonFieldGrid count={2} heights={[44, 124]} />
        </SkeletonCard>

        <SkeletonCard>
          <SkeletonHeader
            eyebrowWidth={152}
            titleWidth="min(240px,46vw)"
            descriptionWidths={["min(420px,82%)", "min(340px,68%)"]}
          />
          <div className="mt-[20px]">
            <SkeletonBar width={112} height={12} className="rounded-full bg-[#111111]" />
            <div className="mt-[10px] grid grid-cols-1 gap-[8px] sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="rounded-[16px] border border-[#171717] bg-[#090909] px-[12px] py-[12px]"
                >
                  <SkeletonBar width="70%" height={12} className="max-w-full rounded-full" />
                  <SkeletonBar width="92%" height={10} className="mt-[8px] max-w-full rounded-full bg-[#111111]" />
                </div>
              ))}
            </div>
          </div>
          <SkeletonBar width="100%" height={58} className="mt-[16px] rounded-[18px] bg-[#0A0A0A]" />
          <SkeletonBar width="100%" height={74} className="mt-[14px] rounded-[18px] bg-[#0A0A0A]" />
          <div className="mt-[14px] grid grid-cols-2 gap-[10px]">
            <SkeletonBar width="100%" height={86} className="rounded-[18px] bg-[#0A0A0A]" />
            <SkeletonBar width="100%" height={86} className="rounded-[18px] bg-[#0A0A0A]" />
          </div>
        </SkeletonCard>
      </div>
    </div>
  );
}

function renderEntryExitOverviewSkeleton() {
  return (
    <div className="space-y-[14px]">
      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={170}
          titleWidth="min(420px,78vw)"
          descriptionWidths={["min(620px,92%)", "min(520px,82%)"]}
          action={<SkeletonToggle />}
        />
      </SkeletonCard>

      <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-2">
        {[
          { eyebrowWidth: 84, titleWidth: "min(250px,52vw)" },
          { eyebrowWidth: 74, titleWidth: "min(240px,50vw)" },
        ].map((item, index) => (
          <SkeletonCard key={index}>
            <SkeletonHeader
              eyebrowWidth={item.eyebrowWidth}
              titleWidth={item.titleWidth}
              descriptionWidths={["min(400px,82%)", "min(310px,66%)"]}
              action={<SkeletonChip width={72} className="h-[30px] bg-[#101010]" />}
            />
            <SkeletonFieldGrid count={2} />
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}

function renderAntiLinkSkeleton() {
  return (
    <div className="space-y-[14px]">
      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={108}
          titleWidth="min(360px,70vw)"
          descriptionWidths={["min(620px,92%)", "min(520px,82%)"]}
          action={<SkeletonToggle />}
        />
      </SkeletonCard>

      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={142}
          titleWidth="min(290px,56vw)"
          descriptionWidths={["min(620px,92%)", "min(500px,80%)"]}
        />
        <SkeletonFieldGrid count={2} />
        <div className="mt-[16px] rounded-[18px] border border-[#161616] bg-[#0A0A0A] px-[14px] py-[14px]">
          <SkeletonBar width={166} height={12} className="rounded-full bg-[#111111]" />
          <SkeletonBar width="100%" height={48} className="mt-[10px] rounded-[14px]" />
        </div>
        <div className="mt-[16px] space-y-[16px]">
          <SkeletonField labelWidth="36%" height={66} />
          <SkeletonField labelWidth="34%" height={66} />
        </div>
      </SkeletonCard>
    </div>
  );
}

function renderAutoRoleSkeleton() {
  return (
    <div className="space-y-[14px]">
      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={112}
          titleWidth="min(330px,66vw)"
          descriptionWidths={["min(620px,92%)", "min(500px,80%)"]}
          action={<SkeletonToggle />}
        />
      </SkeletonCard>

      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={152}
          titleWidth="min(300px,58vw)"
          descriptionWidths={["min(600px,90%)", "min(520px,82%)"]}
        />
        <SkeletonFieldGrid count={2} />

        <div className="mt-[16px] space-y-[12px]">
          <div className="rounded-[16px] border border-[#141414] bg-[#0A0A0A] px-[14px] py-[12px]">
            <div className="flex items-start gap-[12px]">
              <SkeletonBar width={18} height={18} className="mt-[2px] rounded-[6px] bg-[#111111]" />
              <div className="min-w-0 flex-1">
                <SkeletonBar width="56%" height={13} className="max-w-full rounded-full" />
                <SkeletonBar width="84%" height={12} className="mt-[8px] max-w-full rounded-full bg-[#111111]" />
                <SkeletonBar width="76%" height={12} className="mt-[8px] max-w-full rounded-full bg-[#111111]" />
              </div>
            </div>
          </div>

          <div className="rounded-[16px] border border-[#141414] bg-[#0A0A0A] px-[14px] py-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-[10px]">
              <div className="space-y-[8px]">
                <SkeletonBar width={156} height={12} className="rounded-full bg-[#111111]" />
                <SkeletonBar width={210} height={11} className="rounded-full bg-[#111111]" />
              </div>
              <SkeletonChip width={98} className="h-[28px] bg-[#101010]" />
            </div>
          </div>

          <div className="overflow-hidden rounded-[20px] border border-[#141414] bg-[linear-gradient(180deg,#090909_0%,#050505_100%)]">
            <div className="border-b border-[#111111] px-[14px] py-[12px]">
              <div className="flex flex-wrap items-center justify-between gap-[10px]">
                <div className="space-y-[8px]">
                  <SkeletonBar width={138} height={12} className="rounded-full bg-[#111111]" />
                  <SkeletonBar width={250} height={11} className="rounded-full bg-[#111111]" />
                </div>
                <div className="flex gap-[8px]">
                  <SkeletonChip width={90} className="h-[28px]" />
                  <SkeletonChip width={118} className="h-[28px] bg-[#101010]" />
                </div>
              </div>
            </div>
            <div className="space-y-[10px] px-[14px] py-[14px]">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-[10px] ${index > 0 ? "border-t border-[#111111] pt-[12px]" : ""}`}
                >
                  <SkeletonBar width={8} height={8} className="mt-[6px] shrink-0 rounded-full bg-[#1D1D1D]" />
                  <div className="min-w-0 flex-1">
                    <SkeletonBar width={index % 2 === 0 ? "36%" : "42%"} height={12} className="max-w-full rounded-full" />
                    <SkeletonBar width={index % 2 === 0 ? "58%" : "64%"} height={10} className="mt-[8px] max-w-full rounded-full bg-[#111111]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SkeletonCard>
    </div>
  );
}

function renderSecurityLogsSkeleton() {
  return (
    <div className="space-y-[14px]">
      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={82}
          titleWidth="min(260px,52vw)"
          descriptionWidths={["min(620px,92%)", "min(560px,88%)"]}
          action={<SkeletonToggle />}
        />
      </SkeletonCard>

      <SkeletonCard>
        <SkeletonHeader
          eyebrowWidth={132}
          titleWidth="min(220px,44vw)"
          descriptionWidths={["min(620px,92%)", "min(540px,84%)"]}
          action={<SkeletonToggle />}
        />
        <div className="mt-[18px] grid grid-cols-1 gap-[16px] xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <SkeletonField labelWidth="34%" height={58} />
          <SkeletonChip width={106} className="h-[32px] bg-[#101010]" />
        </div>
      </SkeletonCard>

      <div className="space-y-[14px]">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonEventRow key={index} />
        ))}
      </div>
    </div>
  );
}

function renderPaymentsSkeleton() {
  return (
    <div className="space-y-[14px]">
      <div className="grid grid-cols-1 gap-3 min-[980px]:grid-cols-[1fr_auto_auto]">
        <SkeletonBar width="100%" height={52} className="rounded-[3px] bg-[#0A0A0A]" />
        <SkeletonBar width="100%" height={52} className="rounded-[3px] bg-[#0A0A0A] min-[980px]:min-w-[238px]" />
        <SkeletonBar width="100%" height={52} className="rounded-[3px] bg-[#0A0A0A] min-[980px]:min-w-[213px]" />
      </div>

      <div className="overflow-hidden rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A]">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className={`flex flex-col gap-3 px-4 py-4 min-[720px]:flex-row min-[720px]:items-start min-[720px]:justify-between min-[720px]:py-3 ${index > 0 ? "border-t border-[#1C1C1C]" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <SkeletonBar width={40} height={40} className="shrink-0 rounded-[3px] bg-[#111111]" />
                <div className="min-w-0 flex-1">
                  <SkeletonBar width={index % 2 === 0 ? "40%" : "48%"} height={14} className="max-w-full rounded-full" />
                  <SkeletonBar width={index % 2 === 0 ? "26%" : "32%"} height={12} className="mt-[8px] max-w-full rounded-full bg-[#111111]" />
                </div>
              </div>
              <div className="mt-[10px] flex flex-wrap gap-[8px]">
                <SkeletonChip width={84} className="h-[20px] rounded-[3px]" />
                <SkeletonChip width={96} className="h-[20px] rounded-[3px] bg-[#101010]" />
              </div>
            </div>

            <div className="flex shrink-0 items-end justify-between gap-3 min-[720px]:block">
              <SkeletonChip width={92} className="h-[24px] rounded-[3px]" />
              <SkeletonBar width={96} height={12} className="mt-[8px] rounded-full bg-[#111111]" />
              <SkeletonBar width={82} height={14} className="mt-[8px] rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderMethodsSkeleton() {
  return (
    <div className="space-y-[14px]">
      <div className="grid grid-cols-1 gap-3 min-[980px]:grid-cols-[1fr_auto_auto]">
        <SkeletonBar width="100%" height={52} className="rounded-[3px] bg-[#0A0A0A]" />
        <SkeletonBar width="100%" height={52} className="rounded-[3px] bg-[#0A0A0A] min-[980px]:min-w-[238px]" />
        <SkeletonBar width="100%" height={52} className="rounded-[3px] bg-[#0A0A0A] min-[980px]:min-w-[213px]" />
      </div>

      <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <article
            key={index}
            className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-4 min-[900px]:py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <SkeletonBar width={40} height={40} className="shrink-0 rounded-[3px] bg-[#111111]" />
                <div className="min-w-0 flex-1">
                  <SkeletonBar width={index % 2 === 0 ? "44%" : "52%"} height={14} className="max-w-full rounded-full" />
                  <SkeletonBar width={index % 2 === 0 ? "58%" : "64%"} height={12} className="mt-[8px] max-w-full rounded-full bg-[#111111]" />
                </div>
              </div>
              <SkeletonChip width={84} className="h-[22px] rounded-[3px]" />
            </div>
            <div className="mt-[14px] flex flex-wrap gap-[8px]">
              <SkeletonChip width={116} className="h-[22px] rounded-[3px] bg-[#101010]" />
              <SkeletonChip width={98} className="h-[22px] rounded-[3px] bg-[#101010]" />
            </div>
            <div className="mt-[14px] flex items-center justify-between gap-[10px]">
              <SkeletonBar width={112} height={12} className="rounded-full bg-[#111111]" />
              <SkeletonIconButton size={36} />
            </div>
          </article>
        ))}
      </div>

      <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-4">
        <SkeletonBar width={136} height={16} className="rounded-full" />
        <SkeletonBar width={260} height={12} className="mt-[10px] rounded-full bg-[#111111]" />
        <div className="mt-4 grid grid-cols-1 gap-3 min-[820px]:grid-cols-2">
          <SkeletonField labelWidth="42%" height={46} />
          <SkeletonField labelWidth="34%" height={46} />
          <SkeletonField labelWidth="38%" height={46} />
          <SkeletonField labelWidth="28%" height={46} />
        </div>
      </div>
    </div>
  );
}

function renderPlansSkeleton() {
  return (
    <div className="space-y-[14px]">
      <div className="rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SkeletonBar width={112} height={18} className="rounded-full" />
            <SkeletonBar width={248} height={12} className="mt-[8px] rounded-full bg-[#111111]" />
          </div>
          <SkeletonChip width={112} className="h-[24px] rounded-[3px]" />
        </div>

        <div className="mt-4 space-y-4">
          <div className="rounded-[3px] border border-[#2E2E2E] bg-[#090909] px-3 py-3">
            <div className="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
              <div>
                <SkeletonBar width={156} height={14} className="rounded-full" />
                <SkeletonBar width={282} height={11} className="mt-[8px] rounded-full bg-[#111111]" />
              </div>
              <SkeletonChip width={96} className="h-[31px] rounded-[3px]" />
            </div>
          </div>

          <div className="rounded-[3px] border border-[#2E2E2E] bg-[#090909] px-3 py-3">
            <div className="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
              <SkeletonBar width={168} height={12} className="rounded-full bg-[#111111]" />
              <SkeletonChip width={132} className="h-[31px] rounded-[3px] bg-[#101010]" />
            </div>
            <SkeletonBar width="100%" height={38} className="mt-3 rounded-[3px] bg-[#0A0A0A]" />
            <div className="mt-3 flex items-center gap-3">
              <SkeletonBar width={38} height={38} className="rounded-[3px] bg-[#111111]" />
              <div className="space-y-[8px]">
                <SkeletonBar width={148} height={14} className="rounded-full" />
                <SkeletonBar width={134} height={12} className="rounded-full bg-[#111111]" />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-[8px]">
          <SkeletonBar width={182} height={12} className="rounded-full bg-[#111111]" />
          <SkeletonBar width={264} height={12} className="rounded-full bg-[#111111]" />
          <SkeletonBar width={292} height={12} className="rounded-full bg-[#111111]" />
        </div>
      </div>
    </div>
  );
}

function resolveSkeletonContent(
  tab: ServerSettingsSkeletonTab,
  settingsSection: ServerSettingsSkeletonSection,
) {
  if (tab === "payments") {
    return renderPaymentsSkeleton();
  }

  if (tab === "methods") {
    return renderMethodsSkeleton();
  }

  if (tab === "plans") {
    return renderPlansSkeleton();
  }

  if (settingsSection === "message") {
    return renderTicketMessageSkeleton();
  }

  if (settingsSection === "ticket_ai") {
    return renderFlowAiSkeleton();
  }

  if (settingsSection === "entry_exit_overview") {
    return renderEntryExitOverviewSkeleton();
  }

  if (settingsSection === "entry_exit_message") {
    return renderTicketMessageSkeleton(true);
  }

  if (settingsSection === "security_antilink") {
    return renderAntiLinkSkeleton();
  }

  if (settingsSection === "security_autorole") {
    return renderAutoRoleSkeleton();
  }

  if (settingsSection === "security_logs") {
    return renderSecurityLogsSkeleton();
  }

  return renderSettingsOverviewSkeleton();
}

export function ServerSettingsEditorSkeleton({
  standalone = false,
  tab = "settings",
  settingsSection = "overview",
}: ServerSettingsEditorSkeletonProps) {
  const resolvedSettingsSection = settingsSection ?? "overview";

  return (
    <section
      className="flowdesk-fade-up-soft"
      style={{
        marginTop: standalone ? "0px" : `${serversScale.cardsTopSpacing}px`,
      }}
      aria-hidden="true"
    >
      {resolveSkeletonContent(tab, resolvedSettingsSection)}
    </section>
  );
}
