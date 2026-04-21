type WorkspaceRouteLoadingProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
};

export function WorkspaceRouteLoading({
  eyebrow,
  title,
  subtitle,
}: WorkspaceRouteLoadingProps) {
  return (
    <div className="min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]"
      />
      <div className="relative mx-auto w-full max-w-[1540px] px-[14px] py-[18px] md:px-[18px] md:py-[24px]">
        <div className="grid gap-[18px] xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-[28px] border border-[#0E0E0E] bg-[#050505] p-[18px] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
            <div className="flex items-center gap-[12px]">
              <div className="flowdesk-shimmer h-[42px] w-[42px] rounded-full bg-[#111111]" />
              <div className="min-w-0 flex-1 space-y-[8px]">
                <div className="flowdesk-shimmer h-[12px] w-[88px] rounded-full bg-[#111111]" />
                <div className="flowdesk-shimmer h-[16px] w-[140px] rounded-full bg-[#151515]" />
              </div>
            </div>

            <div className="mt-[20px] rounded-[18px] border border-[#121212] bg-[#080808] px-[14px] py-[12px]">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#5E5E5E]">
                {eyebrow}
              </p>
              <h1 className="mt-[8px] text-[20px] font-medium tracking-[-0.04em] text-[#F3F3F3]">
                {title}
              </h1>
              <p className="mt-[8px] max-w-[26ch] text-[13px] leading-[1.55] text-[#777777]">
                {subtitle}
              </p>
            </div>

            <div className="mt-[18px] space-y-[8px]">
              {Array.from({ length: 8 }, (_, index) => (
                <div
                  key={index}
                  className="flowdesk-shimmer h-[44px] rounded-[16px] border border-[#111111] bg-[#0A0A0A]"
                />
              ))}
            </div>
          </aside>

          <main className="overflow-hidden rounded-[28px] border border-[#0E0E0E] bg-[#0A0A0A] p-[18px] shadow-[0_24px_80px_rgba(0,0,0,0.38)]">
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              <div className="space-y-[8px]">
                <div className="flowdesk-shimmer h-[12px] w-[120px] rounded-full bg-[#111111]" />
                <div className="flowdesk-shimmer h-[26px] w-[260px] rounded-full bg-[#151515]" />
              </div>
              <div className="flowdesk-shimmer h-[44px] w-[188px] rounded-[16px] bg-[#111111]" />
            </div>

            <div className="mt-[20px] grid gap-[12px] md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="flowdesk-shimmer h-[132px] rounded-[22px] border border-[#131313] bg-[#090909]"
                />
              ))}
            </div>

            <div className="mt-[18px] flowdesk-shimmer h-[420px] rounded-[26px] border border-[#131313] bg-[#080808]" />
          </main>
        </div>
      </div>
    </div>
  );
}
