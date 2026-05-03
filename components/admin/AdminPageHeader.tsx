import { LandingGlowTag } from "@/components/landing/LandingGlowTag";

type AdminPageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
};

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: AdminPageHeaderProps) {
  return (
    <div className="flex flex-col gap-[18px] xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <LandingGlowTag className="px-[22px]">{eyebrow}</LandingGlowTag>
        <h1 className="mt-[18px] text-[34px] leading-[0.98] font-medium tracking-[-0.05em] text-[#F3F3F3] md:text-[42px]">
          {title}
        </h1>
        <p className="mt-[14px] max-w-[820px] text-[14px] leading-[1.7] text-[#7A7A7A] md:text-[15px]">
          {description}
        </p>
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-[10px] xl:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
