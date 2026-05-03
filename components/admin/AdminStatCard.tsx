type AdminStatCardProps = {
  label: string;
  value: string;
  description: string;
  icon?: React.ReactNode;
};

export function AdminStatCard({
  label,
  value,
  description,
  icon,
}: AdminStatCardProps) {
  return (
    <article className="group overflow-hidden rounded-[22px] border border-[#141414] bg-[linear-gradient(180deg,#0A0A0A_0%,#050505_100%)] p-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.24)] transition-colors duration-200 hover:border-[#1F1F1F] hover:bg-[linear-gradient(180deg,#0D0D0D_0%,#070707_100%)]">
      <div className="flex items-start justify-between gap-[14px]">
        <div>
          <p className="text-[12px] uppercase tracking-[0.18em] text-[#666666]">
            {label}
          </p>
          <p className="mt-[14px] text-[34px] leading-none font-medium tracking-[-0.05em] text-[#F5F5F5]">
            {value}
          </p>
        </div>

        {icon ? (
          <div className="flex h-[48px] w-[48px] items-center justify-center rounded-[16px] border border-[#181818] bg-[#0E0E0E] text-[#CFCFCF]">
            {icon}
          </div>
        ) : null}
      </div>

      <p className="mt-[14px] text-[13px] leading-[1.65] text-[#7A7A7A]">
        {description}
      </p>
    </article>
  );
}
