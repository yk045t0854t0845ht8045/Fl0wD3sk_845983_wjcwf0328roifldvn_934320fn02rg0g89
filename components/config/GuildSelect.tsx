"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Check, Crown, Search, ShieldCheck, Star } from "lucide-react";

type GuildItem = {
  id: string;
  name: string;
  icon_url: string | null;
  owner: boolean;
  admin: boolean;
  description?: string | null;
};

type GuildSelectProps = {
  guilds: GuildItem[];
  selectedGuildId: string | null;
  onSelect: (guildId: string) => void;
  isLoading: boolean;
};

type GuildFavoritesApiResponse = {
  ok: boolean;
  favoriteGuildIds?: string[];
};

type GuildPalette = {
  from: string;
  via: string;
  glow: string;
};

const GUILD_BACKDROP_PALETTES: GuildPalette[] = [
  { from: "#0E1A2B", via: "#0A0A0A", glow: "rgba(62,124,255,0.22)" },
  { from: "#1D152D", via: "#0A0A0A", glow: "rgba(155,92,255,0.2)" },
  { from: "#142117", via: "#0A0A0A", glow: "rgba(72,196,114,0.18)" },
  { from: "#26190F", via: "#0A0A0A", glow: "rgba(255,157,71,0.2)" },
  { from: "#1E1117", via: "#0A0A0A", glow: "rgba(255,96,124,0.18)" },
  { from: "#111C24", via: "#0A0A0A", glow: "rgba(90,196,255,0.18)" },
];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isSubsequence(query: string, target: string) {
  if (!query) return true;

  let queryIndex = 0;
  for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
    if (target[targetIndex] === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex >= query.length) return true;
    }
  }

  return false;
}

function getGuildSearchScore(guild: GuildItem, searchQuery: string) {
  if (!searchQuery) return 1;

  const normalizedName = normalizeSearchText(guild.name);
  const compactName = normalizedName.replace(/\s+/g, "");
  const compactQuery = searchQuery.replace(/\s+/g, "");
  const normalizedId = guild.id.toLowerCase();

  if (normalizedId === searchQuery) return 140;
  if (normalizedName === searchQuery) return 120;
  if (normalizedId.startsWith(searchQuery)) return 110;
  if (normalizedName.startsWith(searchQuery)) return 100;
  if (normalizedName.includes(searchQuery)) return 85;
  if (normalizedId.includes(searchQuery)) return 72;

  const queryTokens = searchQuery.split(/\s+/).filter(Boolean);
  if (queryTokens.length > 1 && queryTokens.every((token) => normalizedName.includes(token))) {
    return 62;
  }

  if (compactQuery && isSubsequence(compactQuery, compactName)) return 48;
  return 0;
}

function hashGuildId(guildId: string) {
  let hash = 0;
  for (let index = 0; index < guildId.length; index += 1) {
    hash = (hash * 31 + guildId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function resolveGuildPalette(guildId: string) {
  return GUILD_BACKDROP_PALETTES[hashGuildId(guildId) % GUILD_BACKDROP_PALETTES.length];
}

function resolveGuildDescription(guild: GuildItem) {
  const customDescription = typeof guild.description === "string" ? guild.description.trim() : "";
  if (customDescription) {
    return customDescription.slice(0, 170);
  }

  if (guild.owner) {
    return "Servidor com posse da conta atual. Ideal para concluir a ativacao do Flowdesk com todos os fluxos de ticket e operacao liberados.";
  }

  if (guild.admin) {
    return "Servidor com acesso administrativo. O proximo passo valida o bot, canais e cargos para continuar a configuracao com seguranca.";
  }

  return "Servidor elegivel para continuar a configuracao do ticket e estruturar o atendimento no painel.";
}

function buildGuildFooterLabel(selected: boolean) {
  return selected ? "Pronto para continuar" : "Escolher servidor";
}

function StarIcon({ active }: { active: boolean }) {
  return (
    <Star
      className={`h-[16px] w-[16px] ${active ? "fill-[#F4D25C] text-[#F4D25C]" : "text-[#7A7A7A]"}`}
      strokeWidth={2}
    />
  );
}

function GuildAvatar({ guild, className = "" }: { guild: GuildItem; className?: string }) {
  if (guild.icon_url) {
    const isAnimated = guild.icon_url.includes(".gif");

    return (
      <Image
        src={guild.icon_url}
        alt={guild.name}
        width={68}
        height={68}
        unoptimized={isAnimated}
        className={`object-cover object-center ${className}`.trim()}
      />
    );
  }

  return (
    <div className={`flex items-center justify-center bg-[#090909] text-[24px] font-semibold text-[#F1F1F1] ${className}`.trim()}>
      {guild.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function GuildCardSkeleton() {
  return (
    <div className="flowdesk-shimmer overflow-hidden rounded-[28px] border border-[#151515] bg-[#090909] shadow-[0_22px_60px_rgba(0,0,0,0.34)]">
      <div className="h-[126px] bg-[linear-gradient(180deg,#101010_0%,#090909_100%)]" />
      <div className="px-[18px] pb-[18px] pt-[16px]">
        <div className="-mt-[34px] flex items-start gap-[14px]">
          <div className="h-[68px] w-[68px] rounded-[22px] border border-[#171717] bg-[#121212]" />
          <div className="min-w-0 flex-1 pt-[38px]">
            <div className="h-[16px] w-[58%] rounded-full bg-[#131313]" />
            <div className="mt-[12px] h-[12px] w-[88%] rounded-full bg-[#101010]" />
            <div className="mt-[8px] h-[12px] w-[76%] rounded-full bg-[#101010]" />
          </div>
        </div>
        <div className="mt-[18px] flex items-center justify-between">
          <div className="h-[11px] w-[90px] rounded-full bg-[#101010]" />
          <div className="h-[11px] w-[108px] rounded-full bg-[#101010]" />
        </div>
      </div>
    </div>
  );
}

export function GuildSelect({
  guilds,
  selectedGuildId,
  onSelect,
  isLoading,
}: GuildSelectProps) {
  const [favoriteGuildIds, setFavoriteGuildIds] = useState<string[]>([]);
  const [hasLoadedFavorites, setHasLoadedFavorites] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [displayedGuilds, setDisplayedGuilds] = useState<GuildItem[]>([]);
  const [gridPhase, setGridPhase] = useState<"idle" | "out" | "in">("idle");
  const [gridRenderVersion, setGridRenderVersion] = useState(0);
  const skipFirstPersistRef = useRef(true);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasHydratedResultsRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function loadFavorites() {
      try {
        const response = await fetch("/api/auth/me/guild-favorites", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Falha ao carregar favoritos.");
        }

        const payload = (await response.json()) as GuildFavoritesApiResponse;
        if (!isMounted) return;

        const normalized = Array.isArray(payload.favoriteGuildIds)
          ? Array.from(
              new Set(
                payload.favoriteGuildIds.filter(
                  (guildId): guildId is string => typeof guildId === "string",
                ),
              ),
            )
          : [];

        setFavoriteGuildIds(normalized);
      } catch {
        if (!isMounted) return;
        setFavoriteGuildIds([]);
      } finally {
        if (!isMounted) return;
        setHasLoadedFavorites(true);
      }
    }

    void loadFavorites();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedFavorites) return;

    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false;
      return;
    }

    async function persistFavorites() {
      try {
        const response = await fetch("/api/auth/me/guild-favorites", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ favoriteGuildIds }),
        });

        if (!response.ok) {
          throw new Error("Falha ao persistir favoritos.");
        }
      } catch {
        // Mantem a selecao local mesmo se falhar o salvamento.
      }
    }

    void persistFavorites();
  }, [favoriteGuildIds, hasLoadedFavorites]);

  const normalizedQuery = useMemo(() => normalizeSearchText(searchQuery), [searchQuery]);

  const orderedGuilds = useMemo(() => {
    const orderIndex = new Map(guilds.map((guild, index) => [guild.id, index]));
    const favoriteOrder = new Map(favoriteGuildIds.map((guildId, index) => [guildId, index]));
    const hasSearch = normalizedQuery.length > 0;

    const mapped = guilds
      .map((guild) => ({
        guild,
        score: hasSearch ? getGuildSearchScore(guild, normalizedQuery) : 1,
      }))
      .filter((item) => item.score > 0);

    mapped.sort((itemA, itemB) => {
      if (hasSearch && itemA.score !== itemB.score) {
        return itemB.score - itemA.score;
      }

      const favIndexA = favoriteOrder.get(itemA.guild.id);
      const favIndexB = favoriteOrder.get(itemB.guild.id);
      const isFavA = favIndexA !== undefined;
      const isFavB = favIndexB !== undefined;

      if (isFavA && isFavB) {
        return (favIndexA || 0) - (favIndexB || 0);
      }

      if (isFavA) return -1;
      if (isFavB) return 1;

      return (orderIndex.get(itemA.guild.id) || 0) - (orderIndex.get(itemB.guild.id) || 0);
    });

    return mapped.map((item) => item.guild);
  }, [favoriteGuildIds, guilds, normalizedQuery]);

  const orderedGuildIdsKey = useMemo(
    () => orderedGuilds.map((guild) => guild.id).join("|"),
    [orderedGuilds],
  );

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
      if (settleTimeoutRef.current) {
        clearTimeout(settleTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!hasHydratedResultsRef.current) {
      hasHydratedResultsRef.current = true;
      setDisplayedGuilds(orderedGuilds);
      setGridRenderVersion((current) => current + 1);
      setGridPhase("in");

      if (settleTimeoutRef.current) {
        clearTimeout(settleTimeoutRef.current);
      }

      settleTimeoutRef.current = setTimeout(() => {
        setGridPhase("idle");
      }, 320);
      return;
    }

    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }
    if (settleTimeoutRef.current) {
      clearTimeout(settleTimeoutRef.current);
    }

    setGridPhase("out");
    transitionTimeoutRef.current = setTimeout(() => {
      setDisplayedGuilds(orderedGuilds);
      setGridRenderVersion((current) => current + 1);
      setGridPhase("in");

      settleTimeoutRef.current = setTimeout(() => {
        setGridPhase("idle");
      }, 320);
    }, 110);
  }, [isLoading, orderedGuildIdsKey, orderedGuilds]);

  function toggleFavorite(guildId: string) {
    if (!hasLoadedFavorites) return;

    setFavoriteGuildIds((current) => {
      if (current.includes(guildId)) {
        return current.filter((id) => id !== guildId);
      }

      return [...current, guildId];
    });
  }

  function isFavorite(guildId: string) {
    return favoriteGuildIds.includes(guildId);
  }

  return (
    <div className="space-y-[20px]">
      <div className="relative overflow-hidden rounded-[18px] border border-[#151515] bg-[#090909]">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.12)_50%,transparent_100%)]" />
        <div className="relative min-w-0">
          <span className="pointer-events-none absolute inset-y-0 left-[16px] flex items-center text-[#666666]">
            <Search className="h-[16px] w-[16px]" strokeWidth={2.1} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder="Pesquisar servidor por nome ou ID"
            className="h-[52px] w-full bg-transparent pl-[46px] pr-[16px] text-[15px] text-[#E4E4E4] outline-none placeholder:text-[#555555]"
            aria-label="Pesquisar servidor"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid gap-[16px] md:grid-cols-2 2xl:grid-cols-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`guild-skeleton-${index}`}
                className="flowdesk-card-rise"
                style={{ animationDelay: `${Math.min(index, 5) * 48}ms` }}
              >
                <GuildCardSkeleton />
              </div>
            ))
          : displayedGuilds.map((guild, index) => {
              const isSelected = guild.id === selectedGuildId;
              const isAnimated = Boolean(guild.icon_url?.includes(".gif"));
              const palette = resolveGuildPalette(guild.id);
              const description = resolveGuildDescription(guild);

              return (
                <div
                  key={`${guild.id}-${gridRenderVersion}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => onSelect(guild.id)}
                  onKeyDown={(event) => {
                    if (event.currentTarget !== event.target) {
                      return;
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(guild.id);
                    }
                  }}
                  style={
                    gridPhase === "in"
                      ? { animationDelay: `${Math.min(index, 5) * 46}ms` }
                      : undefined
                  }
                  className={`group relative overflow-hidden rounded-[28px] border text-left shadow-[0_22px_60px_rgba(0,0,0,0.34)] transition-[opacity,transform,border-color,background-color,box-shadow] duration-250 ${
                    isSelected
                      ? "border-[rgba(119,180,255,0.34)] bg-[#0D0D0D] shadow-[0_26px_80px_rgba(21,74,170,0.16)]"
                      : "border-[#151515] bg-[#090909] hover:border-[#202020] hover:bg-[#0C0C0C] hover:-translate-y-[2px]"
                  } ${
                    gridPhase === "in"
                      ? "flowdesk-card-rise"
                      : gridPhase === "out"
                        ? "opacity-0 translate-y-[10px] scale-[0.985]"
                        : "opacity-100 translate-y-0 scale-100"
                  }`}
                >
                  <div className="relative h-[126px] overflow-hidden">
                    <div
                      className="absolute inset-0"
                      style={{
                        background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.via} 72%)`,
                      }}
                    />
                    {guild.icon_url ? (
                      <Image
                        src={guild.icon_url}
                        alt={guild.name}
                        fill
                        unoptimized={isAnimated}
                        className="object-cover object-center opacity-40 saturate-[1.08]"
                      />
                    ) : null}
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,4,4,0.04)_0%,rgba(4,4,4,0.18)_35%,rgba(4,4,4,0.82)_100%)]" />
                    <div
                      className="absolute inset-0"
                      style={{
                        background: `radial-gradient(circle_at_top_left, ${palette.glow} 0%, rgba(255,255,255,0.04) 24%, transparent 62%)`,
                      }}
                    />

                    <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-[10px] p-[16px]">
                      <div className="flex flex-wrap gap-[8px]">
                        {isSelected ? (
                          <span className="inline-flex h-[28px] items-center gap-[6px] rounded-full border border-[rgba(141,193,255,0.26)] bg-[rgba(9,16,26,0.56)] px-[11px] text-[11px] font-medium uppercase tracking-[0.14em] text-[#DDEEFF] backdrop-blur-[14px]">
                            <Check className="h-[12px] w-[12px]" strokeWidth={2.2} />
                            Selecionado
                          </span>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleFavorite(guild.id);
                        }}
                        disabled={!hasLoadedFavorites}
                        aria-label={
                          isFavorite(guild.id)
                            ? `Remover ${guild.name} dos favoritos`
                            : `Favoritar ${guild.name}`
                        }
                        className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(8,8,8,0.54)] text-[#7A7A7A] backdrop-blur-[14px] transition-colors hover:text-[#F4D25C] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <StarIcon active={isFavorite(guild.id)} />
                      </button>
                    </div>
                  </div>

                  <div className="relative px-[18px] pb-[18px] pt-[16px]">
                    <div className="-mt-[36px] flex items-start gap-[14px]">
                      <div className="relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-[22px] border border-[rgba(255,255,255,0.08)] bg-[#090909] shadow-[0_18px_34px_rgba(0,0,0,0.38)]">
                        <GuildAvatar guild={guild} className="h-full w-full" />
                      </div>

                      <div className="min-w-0 flex-1 pt-[38px]">
                        <div className="flex min-w-0 items-center gap-[8px]">
                          <h3 className="min-w-0 flex-1 truncate whitespace-nowrap text-[18px] font-medium tracking-[-0.03em] text-[#F1F1F1]">
                            {guild.name}
                          </h3>
                          {guild.owner ? (
                            <span className="inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-full border border-[#1D2734] bg-[#0D141E] px-[10px] text-[11px] font-medium text-[#BCD7FF]">
                              <Crown className="h-[12px] w-[12px]" strokeWidth={2.1} />
                              Dono
                            </span>
                          ) : guild.admin ? (
                            <span className="inline-flex h-[26px] shrink-0 items-center gap-[6px] rounded-full border border-[#18211C] bg-[#0D1510] px-[10px] text-[11px] font-medium text-[#C3F0CF]">
                              <ShieldCheck className="h-[12px] w-[12px]" strokeWidth={2.1} />
                              Admin
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-[10px] line-clamp-3 text-[13px] leading-[1.62] text-[#8B8B8B]">
                          {description}
                        </p>
                      </div>
                    </div>

                    <div className="mt-[18px] flex items-center justify-between gap-[12px] border-t border-[#131313] pt-[14px]">
                      <span className="truncate text-[12px] font-medium text-[#666666]">
                        ID {guild.id}
                      </span>
                      <span className={`text-[12px] font-medium ${isSelected ? "text-[#DCEAFF]" : "text-[#7E7E7E]"}`}>
                        {buildGuildFooterLabel(isSelected)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
      </div>

      {!isLoading && !displayedGuilds.length ? (
        <div className={`rounded-[28px] border border-dashed border-[#1B1B1B] bg-[#090909] px-[22px] py-[34px] text-center transition-[opacity,transform] duration-180 ${
          gridPhase === "out" ? "opacity-0 translate-y-[8px]" : "opacity-100 translate-y-0"
        }`}>
          <p className="text-[17px] font-medium text-[#E4E4E4]">Nenhum servidor encontrado</p>
          <p className="mt-[8px] text-[14px] leading-[1.65] text-[#7A7A7A]">
            Tente pesquisar por outro nome ou pelo ID do servidor para continuar.
          </p>
        </div>
      ) : null}
    </div>
  );
}

