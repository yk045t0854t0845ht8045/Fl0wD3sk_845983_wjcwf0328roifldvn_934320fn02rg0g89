import Image from "next/image";
import { DiscordLoginButton } from "@/components/login/DiscordLoginButton";
import { loginScale } from "@/components/login/loginScale";

export function LoginPanel() {
  const discordInviteUrl = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL || "#";
  const termsUrl = process.env.NEXT_PUBLIC_TERMS_URL || "#";
  const privacyUrl = process.env.NEXT_PUBLIC_PRIVACY_URL || "#";

  return (
    <section className="w-full" style={{ maxWidth: `${loginScale.maxWidth}px` }}>
      <div className="flex flex-col items-center" style={{ gap: `${loginScale.spacing}px` }}>
        <div
          className="relative shrink-0"
          style={{
            width: `${loginScale.logoSize}px`,
            height: `${loginScale.logoSize}px`,
          }}
        >
          <Image
            src="/cdn/logos/logotipo.png"
            alt="Flowdesk"
            fill
            sizes={`${loginScale.logoSize}px`}
            className="object-contain"
            priority
          />
        </div>

        <h1
          className="text-center leading-[1.15] font-medium text-[#D8D8D8]"
          style={{ fontSize: `${loginScale.titleSize}px` }}
        >
          Login com Flowdesk
        </h1>

        <div className="h-px w-full bg-[#242424]" />

        <DiscordLoginButton href="/api/auth/discord" />

        <p
          className="text-center leading-[1.2] text-[#C2C2C2]"
          style={{ fontSize: `${loginScale.smallTextSize}px` }}
        >
          Deseja fazer parte do nosso discord?{" "}
          <a
            href={discordInviteUrl}
            className="text-[#5865F2] hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Clique aqui
          </a>
        </p>

        <div
          className="flex items-center justify-center leading-[1.2] text-[#828282]"
          style={{
            gap: `${loginScale.spacing}px`,
            fontSize: `${loginScale.smallTextSize}px`,
          }}
        >
          <a href={termsUrl} className="hover:underline">
            Termos
          </a>
          <a href={privacyUrl} className="hover:underline">
            Politica de Privacidade
          </a>
        </div>
      </div>
    </section>
  );
}
