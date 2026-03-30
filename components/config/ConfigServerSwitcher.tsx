"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, ChevronDown } from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";

export type ConfigGuildItem = {
  id: string;
  name: string;
  icon_url: string | null;
};

type ConfigServerSwitcherProps = {
  guilds: ConfigGuildItem[];
  selectedGuildId: string | null;
  isLoading?: boolean;
  isSwitching?: boolean;
  onSelectGuild: (guildId: string) => void;
};

function buildGuildInitial(guild: ConfigGuildItem | null) {
  const name = String(guild?.name || "").trim();
  return name ? name.slice(0, 1).toUpperCase() : "S";
}

function GuildAvatar({
  guild,
  sizeClassName,
}: {
  guild: ConfigGuildItem | null;
  sizeClassName: string;
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[#101010] font-semibold text-[#ECECEC] ${sizeClassName}`.trim()}
    >
      {guild?.icon_url ? (
        <Image
          src={guild.icon_url}
          alt={guild.name}
          fill
          sizes="48px"
          className="object-cover"
          unoptimized
        />
      ) : (
        buildGuildInitial(guild)
      )}
    </span>
  );
}

export function ConfigServerSwitcher({
  guilds,
  selectedGuildId,
  isLoading = false,
  isSwitching = false,
  onSelectGuild,
}: ConfigServerSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const scrollClass = "config-switcher-scroll";
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) || null,
    [guilds, selectedGuildId],
  );

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!rootRef.current || !target) return;
      if (!rootRef.current.contains(target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="fixed left-1/2 top-4 z-40 w-[min(720px,calc(100vw-24px))] -translate-x-1/2"
    >
      <div className="relative overflow-hidden rounded-[28px] shadow-[0_26px_90px_rgba(0,0,0,0.4)] backdrop-blur-[18px]">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[28px] border border-[#0E0E0E]"
        />
        <span
          aria-hidden="true"
          className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[28px]"
        />
        <span
          aria-hidden="true"
          className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[28px]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[1px] rounded-[27px] bg-[linear-gradient(180deg,rgba(8,8,8,0.985)_0%,rgba(4,4,4,0.985)_100%)]"
        />
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          disabled={isLoading || isSwitching || guilds.length === 0}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className="relative z-10 flex w-full items-center gap-[14px] px-[18px] py-[16px] text-left disabled:cursor-not-allowed disabled:opacity-45 sm:px-[22px] sm:py-[18px]"
        >
          <GuildAvatar guild={selectedGuild} sizeClassName="h-[46px] w-[46px] text-[17px]" />

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium tracking-[0.18em] uppercase text-[#6D6D6D]">
              Servidor ativo
            </p>
            <p className="mt-[6px] truncate text-[18px] leading-[1.08] font-medium tracking-[-0.04em] text-[#ECECEC]">
              {selectedGuild ? selectedGuild.name : "Selecione um servidor"}
            </p>
          </div>

          <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#8A8A8A]">
            {isSwitching ? (
              <ButtonLoader size={16} colorClassName="text-[#D8D8D8]" />
            ) : (
              <ChevronDown
                className={`h-[18px] w-[18px] transition-transform duration-200 ${isOpen ? "rotate-180" : "rotate-0"}`}
                strokeWidth={2.2}
              />
            )}
          </span>
        </button>
      </div>

      {isOpen ? (
        <div className="relative mt-[10px] overflow-hidden rounded-[26px] shadow-[0_26px_90px_rgba(0,0,0,0.42)] backdrop-blur-[16px]">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[26px] border border-[#121212]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[1px] rounded-[25px] bg-[linear-gradient(180deg,rgba(9,9,9,0.985)_0%,rgba(5,5,5,0.985)_100%)]"
          />

          <div
            className={`${scrollClass} relative z-10 max-h-[320px] overflow-y-auto p-[8px]`}
            role="listbox"
            aria-label="Servidores"
          >
            {guilds.map((guild) => {
              const isActive = guild.id === selectedGuildId;
              return (
                <button
                  key={guild.id}
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onSelectGuild(guild.id);
                  }}
                  disabled={isSwitching}
                  className={`flex w-full items-center gap-[14px] rounded-[18px] px-[14px] py-[12px] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    isActive
                      ? "border border-[rgba(128,184,255,0.2)] bg-[rgba(16,23,34,0.88)]"
                      : "border border-transparent hover:border-[#171717] hover:bg-[#101010]"
                  }`}
                >
                  <GuildAvatar guild={guild} sizeClassName="h-[42px] w-[42px] text-[15px]" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-[#E3E3E3]">
                      {guild.name}
                    </p>
                    <p className="mt-[4px] truncate text-[12px] text-[#757575]">
                      {isActive ? "Servidor atual" : `ID ${guild.id}`}
                    </p>
                  </div>

                  {isActive ? (
                    <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[rgba(128,184,255,0.2)] bg-[rgba(128,184,255,0.12)] text-[#DDEEFF]">
                      <Check className="h-[14px] w-[14px]" strokeWidth={2.5} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .${scrollClass} {
          scrollbar-width: thin;
          scrollbar-color: #2b2b2b #080808;
        }

        .${scrollClass}::-webkit-scrollbar {
          width: 6px;
        }

        .${scrollClass}::-webkit-scrollbar-track {
          background: #080808;
          border-radius: 999px;
        }

        .${scrollClass}::-webkit-scrollbar-thumb {
          background: #2b2b2b;
          border-radius: 999px;
          border: 1px solid #080808;
        }
      `}</style>
    </div>
  );
}
