type AdminStatusBadgeProps = {
  status: string;
  label?: string | null;
};

function normalizeStatusTone(status: string) {
  const normalized = status.trim().toLowerCase();

  if (
    normalized === "active" ||
    normalized === "approved" ||
    normalized === "allowed" ||
    normalized === "operational" ||
    normalized === "low"
  ) {
    return {
      shell: "border-[rgba(79,210,134,0.18)] bg-[rgba(79,210,134,0.08)] text-[#98E6B4]",
      dot: "bg-[#4FD286]",
    };
  }

  if (
    normalized === "pending" ||
    normalized === "review" ||
    normalized === "monitoring" ||
    normalized === "identified" ||
    normalized === "medium" ||
    normalized === "warning"
  ) {
    return {
      shell: "border-[rgba(243,180,74,0.18)] bg-[rgba(243,180,74,0.08)] text-[#F2C56B]",
      dot: "bg-[#F3B44A]",
    };
  }

  if (
    normalized === "critical" ||
    normalized === "high" ||
    normalized === "major_outage" ||
    normalized === "blocked" ||
    normalized === "revoked" ||
    normalized === "disabled" ||
    normalized === "rejected" ||
    normalized === "suspended"
  ) {
    return {
      shell: "border-[rgba(255,110,110,0.18)] bg-[rgba(255,110,110,0.08)] text-[#FFABAB]",
      dot: "bg-[#FF6E6E]",
    };
  }

  return {
    shell: "border-[#1C1C1C] bg-[#101010] text-[#BFBFBF]",
    dot: "bg-[#6F6F6F]",
  };
}

function humanizeStatusLabel(status: string) {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function AdminStatusBadge({
  status,
  label,
}: AdminStatusBadgeProps) {
  const tone = normalizeStatusTone(status);

  return (
    <span
      className={`inline-flex items-center gap-[8px] rounded-full border px-[12px] py-[7px] text-[12px] font-medium tracking-[0.01em] ${tone.shell}`.trim()}
    >
      <span className={`h-[7px] w-[7px] rounded-full ${tone.dot}`.trim()} />
      {label || humanizeStatusLabel(status)}
    </span>
  );
}
