import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import { TranscriptAccessPageClient } from "@/components/transcripts/TranscriptAccessPageClient";
import { getTranscriptSessionFromCookie } from "@/lib/transcripts/access";
import {
  getTicketTranscriptPreviewByProtocol,
  normalizeTranscriptProtocol,
} from "@/lib/transcripts/data";

type TranscriptPageProps = {
  params: Promise<{
    protocol: string;
  }>;
};

export default async function TranscriptPage({ params }: TranscriptPageProps) {
  const routeParams = await params;
  const normalizedProtocol = normalizeTranscriptProtocol(routeParams.protocol);
  const displayProtocol =
    normalizedProtocol || String(routeParams.protocol || "").trim().toUpperCase() || "TRANSCRIPT";

  const transcript = normalizedProtocol
    ? await getTicketTranscriptPreviewByProtocol(normalizedProtocol)
    : null;
  const session =
    normalizedProtocol && transcript
      ? await getTranscriptSessionFromCookie(normalizedProtocol)
      : null;

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <LandingFrameLines />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0.01)_24%,transparent_62%)]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1582px] items-center justify-center px-[20px] pt-[88px] pb-[30px] md:px-6 lg:px-8 xl:px-10 2xl:px-[20px]">
        <TranscriptAccessPageClient
          protocol={displayProtocol}
          initialSessionExpiresAt={
            session ? new Date(session.exp).toISOString() : null
          }
          isUnavailable={!normalizedProtocol || !transcript}
        />
      </div>
    </main>
  );
}
