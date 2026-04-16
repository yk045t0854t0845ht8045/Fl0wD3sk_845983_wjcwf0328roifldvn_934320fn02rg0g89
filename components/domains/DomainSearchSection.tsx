"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Check, Search, Shield, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type DomainMode = "register" | "ai";

type DomainResult = {
  domain: string;
  extension: string;
  status: string;
  isAvailable: boolean;
  price: number;
  currency: string;
  isPremium: boolean;
  reason: string;
  whois: string;
};

type RegisterSearchResponse = {
  ok: true;
  query: string;
  exactDomain: string | null;
  searchedTlds: string[];
  results: DomainResult[];
  exchangeRate: number;
};

type DomainSearchFailure = {
  ok: false;
  message: string;
};

function resolveDomainSearchMessage(input: {
  isLoading?: boolean;
  status?: number;
  backendMessage?: string | null;
}) {
  if (input.status === 503) {
    return "Sistema de domínios se encontra em manutenção no momento. Tente novamente mais tarde.";
  }

  if (input.backendMessage && /manutenc/i.test(input.backendMessage)) {
    return "Sistema de domínios se encontra em manutenção no momento. Tente novamente mais tarde.";
  }

  if (input.backendMessage && /circuit breaker is open/i.test(input.backendMessage)) {
    return "Sistema de domínios se encontra em manutenção no momento. Tente novamente mais tarde.";
  }

  return input.backendMessage?.trim() || "Nao foi possivel concluir a busca agora. Tente novamente.";
}

type AiSuggestionGroup = {
  name: string;
  rationale: string;
  search: {
    exactDomain: string | null;
    searchedTlds: string[];
    results: DomainResult[];
  };
};

type DomainAiResponse = {
  ok: true;
  prompt: string;
  companySummary: string;
  styleNotes: string;
  suggestions: AiSuggestionGroup[];
};

type FilterOption = {
  id: string;
  label: string;
  match: (result: DomainResult) => boolean;
};

const FILTERS: FilterOption[] = [
  {
    id: "popular",
    label: "Popular",
    match: (result) => ["com", "com.br", "org", "net"].includes(result.extension),
  },
  {
    id: "empresas",
    label: "Empresas",
    match: (result) => ["com", "com.br"].includes(result.extension),
  },
  {
    id: "internacional",
    label: "Internacional",
    match: (result) => ["com", "io", "org", "net"].includes(result.extension),
  },
  {
    id: "tech",
    label: "Tech",
    match: (result) => ["com", "io", "ai"].includes(result.extension),
  },
  {
    id: "marca",
    label: "Marca",
    match: (result) => ["com", "com.br", "io"].includes(result.extension),
  },
  {
    id: "todos",
    label: "Todos",
    match: () => true,
  },
];

const MODE_ROUTE: Record<DomainMode, string> = {
  register: "/domains/search",
  ai: "/domains/flowai/search",
};

const MODE_STORAGE_KEY: Record<DomainMode, string> = {
  register: "flowdesk:domains:register-search",
  ai: "flowdesk:domains:ai-search",
};

const DISCOUNT_LABELS: Record<string, string> = {
  "com.br": "98%",
  ai: "18%",
  bet: "70%",
  org: "40%",
  store: "98%",
  online: "97%",
  tech: "89%",
  io: "15%",
};

function readStoredSearch(mode: DomainMode) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.sessionStorage.getItem(MODE_STORAGE_KEY[mode])?.trim() || "";
  } catch {
    return "";
  }
}

function persistSearch(mode: DomainMode, query: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(MODE_STORAGE_KEY[mode], query.trim());
  } catch {
    // Ignore storage errors in private mode or blocked storage environments.
  }
}

function replaceVisibleRoute(route: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.history.replaceState(window.history.state, "", route);
}

function formatMoney(amount: number, currency: string, rate = 5.65) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Consulte valor";
  }

  let finalAmount = amount;
  let finalCurrency = "BRL";

  if (currency === "USD" || !currency) {
    finalAmount = amount * rate;
  } else {
    finalCurrency = currency;
  }

  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: finalCurrency,
      minimumFractionDigits: 2,
    }).format(finalAmount);
  } catch {
    return `${finalCurrency} ${finalAmount.toFixed(2)}`;
  }
}

function compactDomainMeta(result: DomainResult) {
  if (result.reason) {
    return result.reason;
  }

  if (result.isAvailable) {
    return `Extensao .${result.extension} pronta para registro.`;
  }

  return `Extensao .${result.extension} atualmente indisponivel.`;
}

function ResultPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "brand" | "premium";
}) {
  const toneClass =
    tone === "success"
      ? "border-[#173026] bg-[#0F1F1A] text-[#77E0B5]"
      : tone === "brand"
        ? "border-[#16315F] bg-[#0E1728] text-[#8DB7FF]"
        : tone === "premium"
          ? "border-[#4A3410] bg-[#221A0D] text-[#F4C56F]"
          : "border-[#1D1D1D] bg-[#101010] text-[#9D9D9D]";

  return (
    <span
      className={`inline-flex items-center rounded-[7px] border px-[10px] py-[5px] text-[11px] leading-none font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

function DiscountBadge({ extension }: { extension: string }) {
  return (
    <span className="inline-flex items-center rounded-[7px] border border-[#16315F]/40 bg-[#0E1728] px-[8px] py-[4px] text-[10px] font-bold tracking-[0.08em] text-[#8DB7FF]">
      ECONOMIZE {DISCOUNT_LABELS[extension] || "25%"}
    </span>
  );
}

function MiniPoint({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-[8px] text-[12px] leading-[1.55] text-[#7C7C7C]">
      <span className="mt-[4px] inline-flex h-[16px] w-[16px] items-center justify-center rounded-[6px] border border-[#171717] bg-[#0F0F0F] text-[#D7D7D7]">
        <Check className="h-[10px] w-[10px]" strokeWidth={2.4} />
      </span>
      <span>{children}</span>
    </div>
  );
}

function AvailabilityText({ result }: { result: DomainResult }) {
  return (
    <ResultPill tone={result.isAvailable ? "success" : "neutral"}>
      {result.isAvailable ? "Disponivel" : "Registrado"}
    </ResultPill>
  );
}

function DomainSkeleton() {
  return (
    <div className="mx-auto mt-7 w-full max-w-[1200px] space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {[1, 2].map((item) => (
          <div
            key={item}
            className="h-[210px] animate-pulse rounded-[22px] border border-[#141414] bg-[#090909]"
          />
        ))}
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-[74px] animate-pulse rounded-[18px] border border-[#141414] bg-[#090909]"
          />
        ))}
      </div>
    </div>
  );
}

type DomainSearchSectionProps = {
  initialTab?: DomainMode;
};

export function DomainSearchSection({ initialTab = "register" }: DomainSearchSectionProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DomainMode>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);
  const [activeFilter, setActiveFilter] = useState("popular");
  const [registerData, setRegisterData] = useState<RegisterSearchResponse | null>(null);
  const [exchangeRate, setExchangeRate] = useState(5.65);
  const [visibleCount, setVisibleCount] = useState(10);
  const [aiData, setAiData] = useState<DomainAiResponse | null>(null);
  const [selectedAiName, setSelectedAiName] = useState<string | null>(null);
  const autoSearchKeyRef = useRef<string | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);

  const aiSelection = useMemo(() => {
    if (!aiData?.suggestions?.length) {
      return null;
    }

    return aiData.suggestions.find((item) => item.name === selectedAiName) || aiData.suggestions[0];
  }, [aiData, selectedAiName]);

  const currentResults = useMemo(() => {
    if (activeTab === "ai") {
      return aiSelection?.search.results || [];
    }

    return registerData?.results || [];
  }, [activeTab, aiSelection, registerData]);

  const currentExactDomain = useMemo(() => {
    if (activeTab === "ai") {
      return aiSelection?.search.exactDomain || null;
    }

    return registerData?.exactDomain || null;
  }, [activeTab, aiSelection, registerData]);

  const exactMatch = useMemo(() => {
    if (!currentResults.length) {
      return null;
    }

    if (currentExactDomain) {
      return currentResults.find((item) => item.domain === currentExactDomain) || currentResults[0];
    }

    return currentResults[0];
  }, [currentExactDomain, currentResults]);

  const bundleDomains = useMemo(() => {
    if (!exactMatch) {
      return [];
    }

    return [exactMatch, ...currentResults.filter((item) => item.domain !== exactMatch.domain).slice(0, 2)];
  }, [currentResults, exactMatch]);

  const bundleAvailableDomains = useMemo(
    () => bundleDomains.filter((item) => item.isAvailable),
    [bundleDomains],
  );

  const bundlePrice = useMemo(
    () => bundleAvailableDomains.reduce((total, item) => total + (item.price > 0 ? item.price : 0), 0),
    [bundleAvailableDomains],
  );

  const bundleCurrency = useMemo(
    () => bundleAvailableDomains[0]?.currency || exactMatch?.currency || "USD",
    [bundleAvailableDomains, exactMatch],
  );

  const filteredOptions = useMemo(() => {
    const filter = FILTERS.find((item) => item.id === activeFilter) || FILTERS[FILTERS.length - 1];

    return currentResults.filter((item) => {
      if (exactMatch && item.domain === exactMatch.domain) {
        return false;
      }

      return filter.match(item);
    });
  }, [activeFilter, currentResults, exactMatch]);

  const handleSearch = useCallback(async (queryToSearch: string, isAi = false) => {
    const normalizedQuery = queryToSearch.trim();
    if (!normalizedQuery) {
      return;
    }

    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;

    setIsLoading(true);
    setError(null);
    setVisibleCount(10);

    try {
      if (isAi) {
        const response = await fetch("/api/domains/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: normalizedQuery }),
          signal: controller.signal,
        });

        const data = (await response.json()) as DomainAiResponse | DomainSearchFailure;
        if (!response.ok || !data.ok) {
          setAiData(null);
          const errorMessage = resolveDomainSearchMessage({
            status: response.status,
            backendMessage: (data as any).message || "Falha ao gerar dominios com IA.",
          });
          setError(errorMessage);
          setIsMaintenanceMode(/manutenc/i.test(errorMessage));
          return;
        }

        setAiData(data);
        setSelectedAiName(data.suggestions[0]?.name || null);
        return;
      }

      // ─── REGISTER MODE (STREAMING) ───
      const response = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: normalizedQuery }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const errorMessage = resolveDomainSearchMessage({
          status: response.status,
          backendMessage: data.message || "Falha ao consultar dominios.",
        });
        setError(errorMessage);
        setIsMaintenanceMode(/manutenc/i.test(errorMessage));
        setIsLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Falha ao iniciar stream de dados.");
      
      const textDecoder = new TextDecoder();


      let buffer = "";
      
      setRegisterData({
        ok: true,
        query: normalizedQuery,
        exactDomain: null,
        searchedTlds: [],
        results: [],
        exchangeRate: 5.75
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += textDecoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            
            if (chunk.isError) {
              setError(chunk.message);
              break;
            }

            if (chunk.exchangeRate) setExchangeRate(chunk.exchangeRate);

            setRegisterData(prev => {
              if (!prev) return prev;
              
              // Only finish loading when isIntermediate is false
              if (!chunk.isIntermediate) {
                setIsLoading(false);
              }

              // Merge results, removing duplicates (prioritize new ones)
              const existingMap = new Map((prev.results || []).map(r => [r.domain, r]));
              chunk.results?.forEach((r: DomainResult) => existingMap.set(r.domain, r));

              return {
                ...prev,
                exactDomain: chunk.exactDomain || prev.exactDomain,
                searchedTlds: Array.from(new Set([...prev.searchedTlds, ...(chunk.searchedTlds || [])])),
                results: Array.from(existingMap.values())
              };
            });

          } catch (e) {
            console.warn("Chunk parse error:", e);
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const fallbackError = resolveDomainSearchMessage({ backendMessage: null });
      setError(fallbackError);
      setIsMaintenanceMode(/manutenc/i.test(fallbackError));
    } finally {
      if (activeRequestRef.current === controller && !isAi) {
        // isLoading is handled inside the stream loop for non-AI
        activeRequestRef.current = null;
      } else if (isAi) {
        setIsLoading(false);
        activeRequestRef.current = null;
      }
    }
  }, []);


  const handleTabChange = useCallback((mode: DomainMode) => {
    setActiveTab(mode);
    setError(null);
    setIsMaintenanceMode(false);
    setActiveFilter("popular");
    setSearchQuery(readStoredSearch(mode));

    const targetRoute = MODE_ROUTE[mode];
    const currentPath = typeof window === "undefined" ? pathname : window.location.pathname;
    if (currentPath !== targetRoute) {
      replaceVisibleRoute(targetRoute);
    }
  }, [pathname]);

  const onFormSubmit = useCallback((event?: FormEvent) => {
    event?.preventDefault();

    const normalizedQuery = searchQuery.trim();
    if (!normalizedQuery) {
      return;
    }

    persistSearch(activeTab, normalizedQuery);
    const targetRoute = MODE_ROUTE[activeTab];
    autoSearchKeyRef.current = `${targetRoute}:${activeTab}:${normalizedQuery}`;
    void handleSearch(normalizedQuery, activeTab === "ai");

    const currentPath = typeof window === "undefined" ? pathname : window.location.pathname;
    if (currentPath !== targetRoute) {
      replaceVisibleRoute(targetRoute);
    }
  }, [activeTab, handleSearch, pathname, searchQuery]);

  useEffect(() => {
    router.prefetch(MODE_ROUTE.register);
    router.prefetch(MODE_ROUTE.ai);
  }, [router]);

  useEffect(() => {
    if (pathname !== MODE_ROUTE[activeTab]) {
      return;
    }

    const storedQuery = readStoredSearch(activeTab);
    if (!storedQuery) {
      return;
    }

    const autoKey = `${pathname}:${activeTab}:${storedQuery}`;
    if (autoSearchKeyRef.current === autoKey) {
      return;
    }

    autoSearchKeyRef.current = autoKey;
    setSearchQuery(storedQuery);
    void handleSearch(storedQuery, activeTab === "ai");
  }, [activeTab, handleSearch, pathname]);

  useEffect(() => {
    return () => {
      activeRequestRef.current?.abort();
    };
  }, []);

  const searchHint =
    activeTab === "ai"
      ? "Ex: Minha empresa vende software para academias e se chama Flow Pulse"
      : "Ex: empresa.com ou Minha Empresa";

  return (
    <div className="w-full">
      <div className="flex flex-col items-center gap-6">
        <div className="relative flex items-center rounded-full border border-[#171717] bg-[#0B0B0B] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <button
            onClick={() => handleTabChange("register")}
            className={`relative flex h-[42px] items-center justify-center rounded-full px-7 text-[14px] font-semibold transition-all ${
              activeTab === "register" ? "text-[#050505]" : "text-[#777] hover:text-[#AAA]"
            }`}
          >
            {activeTab === "register" && (
              <motion.div
                layoutId="domain-active-tab"
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
              />
            )}
            <span className="relative z-10">Buscar dominio</span>
          </button>

          <button
            onClick={() => handleTabChange("ai")}
            className={`relative flex h-[42px] items-center justify-center gap-2 rounded-full px-7 text-[14px] font-semibold transition-all ${
              activeTab === "ai" ? "text-[#050505]" : "text-[#777] hover:text-[#AAA]"
            }`}
          >
            {activeTab === "ai" && (
              <motion.div
                layoutId="domain-active-tab"
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <Sparkles className={`h-4 w-4 ${activeTab === "ai" ? "text-[#0F62FE]" : ""}`} />
              Criar com IA
            </span>
          </button>
        </div>

        <form
          onSubmit={onFormSubmit}
          className="w-full rounded-[28px] border border-[#171717] bg-[linear-gradient(180deg,#0E0E0E_0%,#080808_100%)] p-[10px] shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-[54px] w-[54px] items-center justify-center rounded-[18px] bg-[#111] text-[#6B7280]">
              {activeTab === "ai" ? (
                <Bot className="h-5 w-5 text-[#0F62FE]" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={searchHint}
              className="min-w-0 flex-1 bg-transparent text-[16px] font-medium text-white outline-none placeholder:text-[#4B5563]"
            />

            <button
              type="submit"
              disabled={isLoading}
              className="group relative flex h-[54px] w-[54px] items-center justify-center overflow-hidden rounded-[18px] bg-[linear-gradient(180deg,#1E66F5_0%,#0F62FE_100%)] text-white transition-all active:scale-[0.95] hover:brightness-110 disabled:opacity-80"
            >
              <AnimatePresence mode="wait">
                {isLoading ? (
                  <motion.div
                    key="loader"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <ButtonLoader size={20} colorClassName="text-white" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="icon"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Search className="h-5 w-5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          </div>

          <AnimatePresence initial={false}>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-[10px] rounded-[18px] bg-[#0A0A0A] px-[16px] py-[12px] text-left text-[12px] leading-[1.55] text-[#9A9A9A]"
                aria-live="polite"
              >
                {resolveDomainSearchMessage({ backendMessage: error })}
              </motion.div>
            )}
          </AnimatePresence>
        </form>

        {activeTab === "ai" && (
          <p className="max-w-[760px] text-center text-[12px] leading-6 text-[#666]">
            O FlowAI analisa a empresa, prioriza disponibilidade em .com e abre para outras extensoes
            fortes quando fizer sentido.
          </p>
        )}
      </div>

      {isLoading && <DomainSkeleton />}

      {!isLoading && !isMaintenanceMode && activeTab === "ai" && aiData && aiData.suggestions.length > 0 && (
        <div className="mx-auto mt-7 w-full max-w-[1200px] rounded-[22px] border border-[#141414] bg-[#090909] p-[16px]">
          <div className="flex flex-col items-start gap-[14px] lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-[8px] text-left">
              <div className="inline-flex items-center gap-[8px] rounded-[7px] border border-[#16315F] bg-[#0E1728] px-[10px] py-[6px] text-[11px] leading-none font-medium text-[#8DB7FF]">
                <Sparkles className="h-[12px] w-[12px]" />
                FlowAI Domains
              </div>
              <h3 className="text-[18px] leading-none font-medium tracking-[-0.04em] text-[#E5E5E5]">
                Sugestoes inteligentes
              </h3>
              <p className="max-w-[720px] text-[12px] leading-[1.6] text-[#7F7F7F]">
                {aiData.companySummary}
              </p>
              <p className="max-w-[720px] text-[11px] leading-[1.6] text-[#666]">
                {aiData.styleNotes}
              </p>
            </div>
          </div>

          <div className="mt-[14px] flex flex-wrap gap-[8px]">
            {aiData.suggestions.map((item) => {
              const isActive = aiSelection?.name === item.name;
              const topResult = item.search.results[0];

              return (
                <button
                  key={item.name}
                  onClick={() => setSelectedAiName(item.name)}
                  className={`flex items-center gap-[8px] rounded-[14px] border px-[12px] py-[10px] text-left transition-colors ${
                    isActive
                      ? "border-[#1B4ED8] bg-[#0F62FE] text-white"
                      : "border-[#141414] bg-[#0A0A0A] hover:border-[#1F1F1F] hover:bg-[#0D0D0D]"
                  }`}
                >
                  <span className="text-[13px] font-medium leading-none">{item.name}</span>
                  {topResult ? (
                    <span
                      className={`text-[11px] leading-none ${
                        isActive ? "text-white/80" : topResult.isAvailable ? "text-[#77E0B5]" : "text-[#767676]"
                      }`}
                    >
                      {topResult.isAvailable ? `.${topResult.extension} livre` : `.${topResult.extension}`}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {aiSelection?.rationale && (
            <div className="mt-[14px] rounded-[16px] border border-[#141414] bg-[#0B0B0B] px-[14px] py-[12px] text-[12px] leading-[1.6] text-[#7C7C7C]">
              <span className="font-medium text-[#D6D6D6]">Leitura da IA:</span>{" "}
              {aiSelection.rationale}
            </div>
          )}
        </div>
      )}

      {!isLoading && !isMaintenanceMode && exactMatch && (
        <div className="mx-auto mt-7 w-full max-w-[1200px] space-y-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)]">
            <section className="flex flex-col rounded-[22px] border border-[#141414] bg-[#0A0A0A] p-[16px]">
              <div className="flex flex-wrap items-center gap-[8px]">
                <ResultPill tone={exactMatch.isAvailable ? "success" : "brand"}>
                  {activeTab === "ai" ? "Melhor opcao" : "Correspondencia exata"}
                </ResultPill>
                <AvailabilityText result={exactMatch} />
                <ResultPill>{exactMatch.status}</ResultPill>
                {exactMatch.isPremium ? <ResultPill tone="premium">Premium</ResultPill> : null}
              </div>

              <div className="mt-[14px] flex flex-1 flex-col justify-between gap-[12px]">
                <div className="space-y-[6px] text-left">
                  <h2 className="truncate text-[28px] leading-none font-medium tracking-[-0.05em] text-[#E5E5E5] md:text-[32px]">
                    {exactMatch.domain}
                  </h2>
                  <p className="max-w-[560px] text-[12px] leading-[1.55] text-[#6F6F6F]">
                    {compactDomainMeta(exactMatch)}
                  </p>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-[12px]">
                  <div className="space-y-[4px] text-left">
                    <div className="flex items-baseline gap-1 text-[24px] leading-none font-medium tracking-[-0.05em] text-[#F1F1F1]">
                      {formatMoney(exactMatch.price, exactMatch.currency, exchangeRate)}
                    </div>
                    <p className="text-[11px] text-[#666]">
                      preco aproximado em BRL com cambio de R$ {exchangeRate.toFixed(2)}
                    </p>
                  </div>

                  <LandingActionButton
                    variant={exactMatch.isAvailable ? "blue" : "dark"}
                    className="h-[42px] min-w-[148px] rounded-[12px] !px-[18px] text-[13px]"
                    disabled={!exactMatch.isAvailable}
                  >
                    {exactMatch.isAvailable ? "Registrar" : "Indisponivel"}
                  </LandingActionButton>
                </div>
              </div>

              <div className="mt-[15px] grid gap-[8px] border-t border-[#141414] pt-[14px]">
                <MiniPoint>Dominio principal com foco em marca, clareza e memorabilidade.</MiniPoint>
                <MiniPoint>Disponibilidade e preco tratados direto da API com normalizacao no backend.</MiniPoint>
              </div>
            </section>

            <section className="flex flex-col rounded-[22px] border border-[#141414] bg-[#0A0A0A] p-[16px]">
              <div className="flex items-center justify-between gap-[10px]">
                <ResultPill tone="brand">Pacote de marca</ResultPill>
                <div className="flex items-center gap-[6px] text-[11px] text-[#707070]">
                  <Shield className="h-[13px] w-[13px]" />
                  {bundleAvailableDomains.length} livre(s)
                </div>
              </div>

              <div className="mt-[14px] flex flex-1 flex-col justify-between gap-[12px]">
                <div className="space-y-[6px] text-left">
                  <h3 className="text-[20px] leading-[1.08] font-medium tracking-[-0.04em] text-[#E5E5E5]">
                    {bundleDomains.map((item, index) => (index === 0 ? item.domain : `+ .${item.extension}`)).join(" ")}
                  </h3>
                  <p className="text-[12px] leading-[1.55] text-[#6F6F6F]">
                    Combine extensoes relevantes para reduzir colisao de marca e proteger a presenca digital.
                  </p>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-[12px]">
                  <div className="space-y-[4px] text-left">
                    <div className="flex items-baseline gap-1 text-[22px] leading-none font-medium tracking-[-0.05em] text-[#F1F1F1]">
                      {formatMoney(bundlePrice, bundleCurrency, exchangeRate)}
                    </div>
                    <p className="text-[11px] text-[#666]">soma aproximada das extensoes mais fortes</p>
                  </div>

                  <LandingActionButton
                    variant={bundleAvailableDomains.length > 0 ? "blue" : "dark"}
                    className="h-[42px] min-w-[148px] rounded-[12px] !px-[18px] text-[13px]"
                    disabled={bundleAvailableDomains.length === 0}
                  >
                    {bundleAvailableDomains.length > 0 ? "Proteger marca" : "Sem opcoes"}
                  </LandingActionButton>
                </div>
              </div>

              <div className="mt-[15px] grid gap-[8px] border-t border-[#141414] pt-[14px]">
                <MiniPoint>Bom para proteger variacoes proximas do dominio principal.</MiniPoint>
                <MiniPoint>Ajuda em SEO, paginas futuras e defesa de branding.</MiniPoint>
              </div>
            </section>
          </div>

          <section className="mt-8">
            <div className="flex flex-col gap-[12px] lg:flex-row lg:items-center lg:justify-between">
              <div className="text-left">
                <h3 className="text-[18px] leading-none font-medium tracking-[-0.04em] text-[#E5E5E5]">
                  Mais opcoes
                </h3>
                <p className="mt-[6px] text-[12px] leading-[1.55] text-[#666]">
                  Extensoes relacionadas organizadas por aderencia de marca e disponibilidade.
                </p>
              </div>

              <div className="flex flex-wrap gap-[8px]">
                {FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() => setActiveFilter(filter.id)}
                    className={`inline-flex items-center rounded-full border px-[12px] py-[7px] text-[12px] leading-none font-medium transition-colors ${
                      activeFilter === filter.id
                        ? "border-[#1B4ED8] bg-[#0F62FE] text-white"
                        : "border-[#171717] bg-[#0D0D0D] text-[#A1A1A1] hover:border-[#222222] hover:bg-[#111111] hover:text-[#E5E5E5]"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-col">
              {filteredOptions.length > 0 ? (
                <>
                  {filteredOptions.slice(0, visibleCount).map((item) => (
                    <div
                      key={item.domain}
                      className="border-t border-[#141414] py-[16px] first:border-0"
                    >
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_auto_auto] lg:items-center">
                        <div className="min-w-0 space-y-[6px] text-left">
                          <div className="flex flex-wrap items-center gap-[10px]">
                            <p className="truncate text-[18px] leading-none font-medium tracking-[-0.04em] text-[#E5E5E5]">
                              {item.domain}
                            </p>
                            <AvailabilityText result={item} />
                            {item.isAvailable ? <DiscountBadge extension={item.extension} /> : null}
                          </div>
                          <p className="truncate text-[11px] leading-[1.55] text-[#666]">
                            {compactDomainMeta(item)}
                          </p>
                        </div>

                        <div className="flex flex-col text-left lg:items-end lg:text-right">
                          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                            {item.price > 0 ? (
                              <span className="text-[12px] text-[#555] line-through decoration-1">
                                {formatMoney(item.price * 1.5, item.currency, exchangeRate)}
                              </span>
                            ) : null}
                            <div className="text-[18px] leading-none font-medium tracking-[-0.04em] text-[#F1F1F1]">
                              {formatMoney(item.price, item.currency, exchangeRate)}
                              <span className="ml-1 text-[12px] font-normal text-[#666]">/ano</span>
                            </div>
                          </div>
                          <p className="mt-[4px] text-[11px] text-[#666]">estimativa para o primeiro ano</p>
                        </div>

                        <div className="lg:justify-self-end">
                          <LandingActionButton
                            variant={item.isAvailable ? "blue" : "dark"}
                            className={`h-[42px] min-w-[152px] rounded-[12px] !px-[18px] text-[13px] font-semibold ${
                              !item.isAvailable
                                ? "border border-[#171717] !bg-[#0D0D0D] text-[#D8D8D8] hover:!border-[#232323] hover:!bg-[#111111] hover:text-[#F1F1F1]"
                                : ""
                            }`}
                            disabled={!item.isAvailable}
                          >
                            {item.isAvailable ? "Comprar agora" : "Indisponivel"}
                          </LandingActionButton>
                        </div>
                      </div>
                    </div>
                  ))}

                  {visibleCount < filteredOptions.length && (
                    <div className="mt-7 flex justify-center border-t border-[#141414] pt-7">
                      <button
                        onClick={() => setVisibleCount((prev) => prev + 10)}
                        className="group flex items-center gap-2 rounded-full border border-[#171717] bg-[#0D0D0D] px-6 py-3 text-[14px] font-medium text-[#A1A1A1] transition-all hover:border-[#222222] hover:bg-[#111111] hover:text-[#E5E5E5]"
                      >
                        Ver mais dominios
                        <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-[#222] bg-[#111] text-[10px] group-hover:bg-[#1A1A1A]">
                          {filteredOptions.length - visibleCount}
                        </div>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="border-t border-[#141414] py-[36px] text-center text-[13px] text-[#6F6F6F]">
                  Nenhum dominio encontrado nesse filtro.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
