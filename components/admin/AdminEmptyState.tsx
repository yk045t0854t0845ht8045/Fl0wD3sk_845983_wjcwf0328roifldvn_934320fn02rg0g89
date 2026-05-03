import { LandingGlowTag } from "@/components/landing/LandingGlowTag";

type AdminEmptyStateProps = {
  badgeLabel: string;
  title: string;
  description: string;
  action?: React.ReactNode;
};

export function AdminEmptyState({
  badgeLabel,
  title,
  description,
  action,
}: AdminEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-[#161616] bg-[#060606] px-[24px] py-[48px] text-center">
      <LandingGlowTag className="px-[22px]">{badgeLabel}</LandingGlowTag>
      <h3 className="mt-[18px] text-[24px] leading-[1.05] font-medium tracking-[-0.04em] text-[#ECECEC]">
        {title}
      </h3>
      <p className="mt-[12px] max-w-[520px] text-[14px] leading-[1.7] text-[#7A7A7A]">
        {description}
      </p>
      {action ? <div className="mt-[20px]">{action}</div> : null}
    </div>
  );
}
