import { redirect } from "next/navigation";
import { DevAuthCompletionCard } from "@/components/dev/DevAuthCompletionCard";
import { buildLoginHref } from "@/lib/auth/paths";
import { getCurrentUserFromSessionCookie } from "@/lib/auth/session";

export default async function DevAuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const attemptToken = token?.trim() || "";

  if (!attemptToken) {
    return (
      <main className="min-h-screen bg-[#050505] px-[20px] py-[48px] text-white">
        <div className="mx-auto max-w-[720px] rounded-[28px] border border-[rgba(255,110,110,0.16)] bg-[#090909] p-[24px]">
          <h1 className="text-[32px] font-medium tracking-[-0.05em] text-[#F3F3F3]">
            Login do CLI invalido
          </h1>
          <p className="mt-[12px] text-[14px] leading-[1.7] text-[#8A8A8A]">
            O token temporario desta solicitacao nao foi informado.
          </p>
        </div>
      </main>
    );
  }

  const user = await getCurrentUserFromSessionCookie();
  if (!user) {
    redirect(buildLoginHref(`/dev-auth/complete?token=${encodeURIComponent(attemptToken)}`));
  }

  return (
    <main className="min-h-screen bg-[#050505] px-[20px] py-[48px] text-white">
      <div className="mx-auto max-w-[720px] rounded-[28px] border border-[#141414] bg-[#090909] p-[24px] shadow-[0_30px_80px_rgba(0,0,0,0.36)]">
        <p className="text-[12px] uppercase tracking-[0.2em] text-[#6F6F6F]">
          Flowdesk CLI
        </p>
        <h1 className="mt-[14px] text-[36px] font-medium tracking-[-0.05em] text-[#F3F3F3]">
          Autorizar login no terminal
        </h1>
        <p className="mt-[14px] text-[14px] leading-[1.7] text-[#848484]">
          Sua sessao web esta ativa como <span className="text-[#D8D8D8]">{user.display_name}</span>. Ao concluir esta etapa, o terminal vai receber a credencial segura do CLI e continuar o fluxo do <code className="rounded bg-[#101010] px-[6px] py-[3px] text-[13px] text-[#E8E8E8]">flw login</code>.
        </p>

        <div className="mt-[22px]">
          <DevAuthCompletionCard attemptToken={attemptToken} />
        </div>
      </div>
    </main>
  );
}
