import { serversScale } from "@/components/servers/serversScale";

type ServerSettingsEditorSkeletonProps = {
  standalone?: boolean;
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
      className={`flowdesk-shimmer rounded-[3px] bg-[#171717] ${className}`.trim()}
      style={{ width, height }}
    />
  );
}

export function ServerSettingsEditorSkeleton({
  standalone = false,
}: ServerSettingsEditorSkeletonProps) {
  const cardPadding = Math.max(16, serversScale.cardPadding + 4);

  return (
    <section
      className="flowdesk-fade-up-soft border border-[#2E2E2E] bg-[#0A0A0A]"
      style={{
        marginTop: standalone ? "0px" : `${serversScale.cardsTopSpacing}px`,
        borderRadius: `${serversScale.cardRadius}px`,
        padding: `${cardPadding}px`,
      }}
      aria-hidden="true"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-[#777777]">Configuracoes do servidor</p>
          <SkeletonBar width={220} height={22} className="mt-2 max-w-full" />
        </div>

        <div className="flex items-center gap-2">
          <SkeletonBar width={74} height={22} />
          <SkeletonBar width={78} height={32} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[#242424] pb-3">
        {[
          118,
          154,
          92,
          70,
        ].map((width, index) => (
          <SkeletonBar key={index} width={width} height={34} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <SkeletonBar width="48%" height={12} />
            <SkeletonBar width="100%" height={60} />
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <SkeletonBar width="100%" height={42} />
        <SkeletonBar width="34%" height={11} />
      </div>
    </section>
  );
}
