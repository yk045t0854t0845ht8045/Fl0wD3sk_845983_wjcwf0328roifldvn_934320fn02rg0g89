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
      className={`flowdesk-shimmer rounded-[12px] bg-[#171717] ${className}`.trim()}
      style={{ width, height }}
    />
  );
}

export function ServerSettingsEditorSkeleton({
  standalone = false,
}: ServerSettingsEditorSkeletonProps) {
  return (
    <section
      className="flowdesk-fade-up-soft"
      style={{
        marginTop: standalone ? "0px" : `${serversScale.cardsTopSpacing}px`,
      }}
      aria-hidden="true"
    >
      <div className="space-y-[16px]">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="overflow-hidden rounded-[24px] border border-[#161616] bg-[#090909] px-[20px] py-[20px]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <SkeletonBar width={72} height={12} className="rounded-full" />
                <SkeletonBar width="42%" height={24} className="mt-3 max-w-full" />
                <SkeletonBar width="58%" height={14} className="mt-4 max-w-full" />
              </div>
              <SkeletonBar width={74} height={28} className="rounded-full" />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
              {Array.from({ length: index === 0 ? 4 : 3 }, (_, fieldIndex) => (
                <div key={fieldIndex} className="flex flex-col gap-2">
                  <SkeletonBar width="46%" height={12} className="rounded-[10px]" />
                  <SkeletonBar width="100%" height={58} className="rounded-[18px]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
