type FlowSecureLoaderInput = {
  src: string;
  width: number;
  quality?: number;
};

export default function flowSecureLoader({
  src,
  width,
  quality,
}: FlowSecureLoaderInput) {
  if (
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.startsWith("/api/flowsecure/polish?")
  ) {
    return src;
  }

  const params = new URLSearchParams({
    src,
    w: String(width),
    mode: "auto",
    format: "auto",
    fit: "inside",
  });

  if (typeof quality === "number" && Number.isFinite(quality)) {
    params.set("q", String(Math.max(35, Math.min(100, Math.round(quality)))));
  }

  return `/api/flowsecure/polish?${params.toString()}`;
}
