import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";

type AdminAuditTimelineEntry = {
  id: string;
  actorLabel: string;
  action: string;
  targetLabel: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  createdAt: string;
};

type AdminAuditTimelineProps = {
  entries: AdminAuditTimelineEntry[];
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AdminAuditTimeline({
  entries,
}: AdminAuditTimelineProps) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-[#141414] bg-[#090909] shadow-[0_20px_60px_rgba(0,0,0,0.22)]">
      <div className="border-b border-[#141414] px-[20px] py-[18px]">
        <h2 className="text-[20px] leading-none font-medium tracking-[-0.03em] text-[#F1F1F1]">
          Ultimas acoes administrativas
        </h2>
        <p className="mt-[10px] text-[13px] leading-[1.6] text-[#737373]">
          Telemetria de acoes sensiveis registrada no backend administrativo.
        </p>
      </div>

      <div className="divide-y divide-[#141414]">
        {entries.map((entry) => (
          <article
            key={entry.id}
            className="flex flex-col gap-[12px] px-[20px] py-[18px] md:flex-row md:items-start md:justify-between"
          >
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-[#E8E8E8]">
                {entry.actorLabel}
              </p>
              <p className="mt-[6px] text-[14px] leading-[1.65] text-[#B6B6B6]">
                {entry.action}
              </p>
              <p className="mt-[6px] text-[12px] leading-[1.6] text-[#707070]">
                {entry.targetLabel}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-[10px]">
              <AdminStatusBadge status={entry.riskLevel} />
              <span className="text-[12px] text-[#6D6D6D]">
                {formatDateTime(entry.createdAt)}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
