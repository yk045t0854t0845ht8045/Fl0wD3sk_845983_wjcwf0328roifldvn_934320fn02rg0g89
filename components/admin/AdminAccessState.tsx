import { LandingGlowTag } from "@/components/landing/LandingGlowTag";

type AdminAccessStateProps = {
  badgeLabel: string;
  title: string;
  description: string;
};

export function AdminAccessState({
  badgeLabel,
  title,
  description,
}: AdminAccessStateProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#040404] px-[24px] py-[32px] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.012)_28%,transparent_68%)]"
      />

      <section className="relative z-10 w-full max-w-[640px] rounded-[30px] border border-[#141414] bg-[linear-gradient(180deg,rgba(10,10,10,0.98)_0%,rgba(5,5,5,0.98)_100%)] px-[24px] py-[32px] text-center shadow-[0_28px_90px_rgba(0,0,0,0.36)]">
        <div className="mx-auto flex w-fit justify-center">
          <LandingGlowTag className="px-[22px]">{badgeLabel}</LandingGlowTag>
        </div>
        <h1 className="mt-[18px] text-[34px] leading-[1.02] font-medium tracking-[-0.05em] text-[#F1F1F1] md:text-[40px]">
          {title}
        </h1>
        <p className="mx-auto mt-[14px] max-w-[560px] text-[14px] leading-[1.7] text-[#7B7B7B] md:text-[15px]">
          {description}
        </p>
      </section>
    </main>
  );
}
