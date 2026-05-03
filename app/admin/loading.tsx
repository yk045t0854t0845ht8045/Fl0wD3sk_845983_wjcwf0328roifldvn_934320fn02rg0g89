function LoadingBar({
  className = "",
}: {
  className?: string;
}) {
  return <div className={`flowdesk-shimmer rounded-[12px] bg-[#171717] ${className}`.trim()} />;
}

export default function AdminLoading() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]"
      />

      <main className="relative px-[20px] pb-[56px] pt-[32px] md:px-6">
        <div className="mx-auto w-full max-w-[1220px]">
          <div className="rounded-[24px] border border-[#141414] bg-[#090909] px-[18px] py-[18px] shadow-[0_18px_56px_rgba(0,0,0,0.22)]">
            <LoadingBar className="h-[12px] w-[120px]" />
            <LoadingBar className="mt-[14px] h-[30px] w-[260px]" />
            <LoadingBar className="mt-[12px] h-[14px] w-[min(780px,100%)]" />
          </div>

          <div className="mt-[24px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={`admin-loading-card-${index}`}
                className="rounded-[22px] border border-[#141414] bg-[#0A0A0A] p-[18px]"
              >
                <LoadingBar className="h-[12px] w-[120px]" />
                <LoadingBar className="mt-[16px] h-[34px] w-[90px]" />
                <LoadingBar className="mt-[12px] h-[12px] w-[100%]" />
              </div>
            ))}
          </div>

          <div className="mt-[18px] grid gap-[14px] xl:grid-cols-[minmax(0,1.12fr)_minmax(340px,0.88fr)]">
            <div className="rounded-[24px] border border-[#141414] bg-[#090909] p-[20px]">
              <LoadingBar className="h-[18px] w-[160px]" />
              <LoadingBar className="mt-[12px] h-[12px] w-[68%]" />
              <div className="mt-[18px] space-y-[12px]">
                {Array.from({ length: 5 }, (_, index) => (
                  <LoadingBar key={`admin-loading-table-${index}`} className="h-[52px] w-[100%]" />
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-[#141414] bg-[#090909] p-[20px]">
              <LoadingBar className="h-[18px] w-[180px]" />
              <LoadingBar className="mt-[12px] h-[12px] w-[72%]" />
              <div className="mt-[18px] space-y-[12px]">
                {Array.from({ length: 4 }, (_, index) => (
                  <LoadingBar key={`admin-loading-feed-${index}`} className="h-[92px] w-[100%]" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
