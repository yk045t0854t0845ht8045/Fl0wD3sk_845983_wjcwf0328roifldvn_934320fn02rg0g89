import { LandingFrameLines } from "@/components/landing/LandingFrameLines";
import { PasswordResetPanel } from "@/components/login/PasswordResetPanel";
import { buildFlowCwvMetadata } from "@/lib/seo/flowCwv";
import type { Metadata } from "next";

export const metadata: Metadata = buildFlowCwvMetadata({
  title: "Redefinir senha",
  description: "Crie uma nova senha para acessar sua conta Flowdesk.",
  pathname: "/pass/v1/tk",
  noIndex: true,
});

type PasswordResetPageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function PasswordResetPage({ params }: PasswordResetPageProps) {
  const { token } = await params;

  return (
    <main className="relative min-h-screen overflow-x-clip bg-[#040404] text-white">
      <LandingFrameLines />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0.01)_24%,transparent_62%)]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1582px] items-center justify-center px-[20px] pt-[88px] pb-[30px] md:px-6 lg:px-8 xl:px-10 2xl:px-[20px]">
        <div className="relative z-10 flex w-full justify-center">
          <PasswordResetPanel token={token} />
        </div>
      </div>
    </main>
  );
}
