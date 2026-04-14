"use client";

import { useState, useMemo } from "react";
import { Search, Sparkles, Loader2, Check, ArrowRight, Info, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { LandingActionButton } from "@/components/landing/LandingActionButton";
import { LandingReveal } from "@/components/landing/LandingReveal";

type DomainResult = {
  domain: string;
  extension: string;
  status: string;
  isAvailable: boolean;
  price: number;
  currency: string;
  isPremium: boolean;
  registryStatuses?: string[];
};

function DomainSkeleton() {
  return (
    <div className="mt-12 w-full max-w-[1000px] animate-pulse space-y-8">
      {/* Simple List Skeleton */}
      <div className="grid gap-[2px] overflow-hidden rounded-[24px] border border-[#141414] bg-[#141414]">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between bg-[#050505] p-6">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-[#111]" />
              <div className="space-y-2">
                <div className="h-5 w-32 rounded-lg bg-[#111]" />
                <div className="h-3 w-16 rounded-full bg-[#111]" />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="h-5 w-20 rounded-lg bg-[#111]" />
              <div className="h-[40px] w-[100px] rounded-xl bg-[#111]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DomainSearchSection() {
  const [activeTab, setActiveTab] = useState<"register" | "ai">("register");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/domains/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: searchQuery }),
      });

      const data = await response.json();
      if (data.ok) {
        setResults(data.results);
      } else {
        setError(data.message || "Erro ao consultar domínios");
      }
    } catch (err) {
      setError("O provedor demorou muito para responder. Tente novamente em instantes.");
    } finally {
      setIsLoading(false);
    }
  };

  const exactMatch = useMemo(() => {
    if (!results.length) return null;
    return results[0];
  }, [results]);

  const otherOptions = useMemo(() => {
    if (results.length <= 1) return [];
    return results.slice(1);
  }, [results]);

  const inputGlowClass = activeTab === "ai" 
    ? "shadow-[0_0_40px_rgba(0,98,255,0.15)] border-[#0062FF]/30" 
    : "border-[#1A1A1A] focus-within:border-[#333]";

  return (
    <div className="flex flex-col items-center">
      {/* Tab Toggle */}
      <div className="relative flex items-center rounded-full bg-[#111111] p-1 border border-[#1A1A1A] shadow-inner">
        <button
          onClick={() => setActiveTab("register")}
          className={`relative h-[42px] px-8 rounded-full flex items-center justify-center text-[15px] font-bold transition-all duration-500 ${
            activeTab === "register" ? "text-[#0A0A0A]" : "text-[#666666] hover:text-[#888]"
          }`}
        >
          {activeTab === "register" && (
            <motion.div
              layoutId="active-pill"
              className="absolute inset-0 bg-white rounded-full z-0"
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
            />
          )}
          <span className="relative z-10">Registro de domínio</span>
        </button>
        <button
          onClick={() => setActiveTab("ai")}
          className={`relative h-[42px] px-8 rounded-full flex items-center justify-center gap-2 text-[15px] font-bold transition-all duration-500 ${
            activeTab === "ai" ? "text-[#0A0A0A]" : "text-[#666666] hover:text-[#888]"
          }`}
        >
          {activeTab === "ai" && (
            <motion.div
              layoutId="active-pill"
              className="absolute inset-0 bg-white rounded-full z-0"
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
            />
          )}
          <div className="relative z-10 flex items-center gap-2">
            <Sparkles className={`h-4 w-4 ${activeTab === "ai" ? "text-[#0062FF]" : ""}`} />
            <span>Crie um domínio com IA</span>
          </div>
        </button>
      </div>

      {/* Search Container */}
      <div className="mt-10 flex w-full max-w-[800px] flex-col">
        <form
          onSubmit={handleSearch}
          className={`flex w-full items-center gap-2 border bg-[#050505] p-2 pr-2 shadow-2xl transition-all duration-500 ${
            error ? "rounded-t-[22px] rounded-b-none border-b-0" : "rounded-[22px]"
          } ${inputGlowClass}`}
        >
          <div className="flex h-[48px] w-[48px] items-center justify-center opacity-40">
            {activeTab === "register" ? <Search className="h-5 w-5" /> : <Sparkles className="h-5 w-5 text-[#0062FF]" />}
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={activeTab === "register" ? "Ex: meuprojeto.com.br" : "Descreva sua ideia para sugestões inteligentes..."}
            className="flex-1 bg-transparent px-2 text-[17px] font-medium text-white outline-none placeholder:text-[#333] placeholder:font-normal"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="flex h-[48px] w-[48px] items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,#0062FF_0%,#0153D5_100%)] text-white transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Search className="h-5 w-5" />
            )}
          </button>
        </form>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ height: 0, opacity: 0, y: -20 }}
              animate={{ height: "auto", opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -20 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-b-[22px] border border-t-0 border-[#2a1212] bg-[#1a0c0c]/80 px-6 py-4 text-center text-[14px] font-bold text-[#ff6b6b] backdrop-blur-md">
                {error}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Loading State */}
      {isLoading && <DomainSkeleton />}

      {/* Results Section */}
      <AnimatePresence mode="wait">
        {results.length > 0 && !isLoading && (
          <div className="mt-20 w-full max-w-[1200px]">
            {/* Exact Match Hero Card */}
            {exactMatch && (
              <LandingReveal delay={100}>
                <div className="flex flex-col overflow-hidden rounded-[28px] border border-[#141414] bg-[#0A0A0A] shadow-[0_32px_80px_rgba(0,0,0,0.5)] transition-all hover:border-[#222]">
                  <div className="p-8 md:p-14">
                    <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex-1 space-y-6">
                        <div className="flex items-center gap-3">
                            <span className="inline-flex items-center rounded-full bg-[#1A3D1A] px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#4ADE80]">
                                Correspondência exata
                            </span>
                        </div>
                        <div className="flex flex-col gap-4">
                          <h2 className="text-[40px] font-bold tracking-tight text-white md:text-[56px]">
                            {exactMatch.domain}
                          </h2>
                          <div className="flex items-center gap-3">
                            <span className="rounded-[10px] border border-[#222] bg-[#111] px-4 py-1.5 text-[13px] font-bold text-[#AAA]">
                                ECONOMIZE 98%
                            </span>
                            <div className="h-1 w-1 rounded-full bg-[#333]" />
                            <span className="text-[15px] font-medium text-[#444]">Ideal para portfolio</span>
                          </div>
                        </div>
                        
                        <div className="flex items-baseline gap-3 pt-4">
                            <span className="text-[32px] font-bold text-white tracking-tight">
                              R$ {exactMatch.price.toFixed(2).replace('.', ',')}
                              <span className="text-[16px] font-medium text-[#444] ml-1">/1º ano</span>
                            </span>
                            <span className="text-[16px] text-[#333] line-through">
                              R$ 64,99
                            </span>
                        </div>
                        
                        <div className="pt-2">
                          <LandingActionButton
                            variant={exactMatch.isAvailable ? "blue" : "dark"}
                            className="h-[54px] w-full md:w-[240px] !text-[17px]"
                            disabled={!exactMatch.isAvailable}
                          >
                            {exactMatch.isAvailable ? "Registrar agora" : "Já Registrado"}
                          </LandingActionButton>
                        </div>
                      </div>

                      <div className="grid gap-6 rounded-[22px] border border-[#141414] bg-[#070707] p-8 lg:w-[400px]">
                        {[
                            "Hospedagem inclusa por 30 dias",
                            "SSL Certificado Gratuito",
                            "Painel de controle simplificado",
                            "Atendimento priorizado Flow",
                        ].map((item, i) => (
                            <div key={i} className="flex items-center gap-4 text-[14px] font-medium text-[#666]">
                                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1A1A1A]">
                                    <Check className="h-3 w-3 text-[#4ADE80]" strokeWidth={3} />
                                </div>
                                {item}
                            </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </LandingReveal>
            )}

            {/* More Options Section */}
            <div className="mt-24 space-y-10">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between px-4">
                <div className="space-y-1">
                    <h3 className="text-[24px] font-bold text-[#E5E5E5] tracking-tight">Explore outras extensões</h3>
                    <p className="text-[14px] text-[#666]">Mais oportunidades para destacar seu projeto no Discord e na Web.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["Popular", "Tech", "Social", "Empresas", "Internacional"].map((filter, i) => (
                    <button
                      key={i}
                      className="rounded-full border border-[#1a1a1a] bg-[#0A0A0A] px-5 py-2 text-[13px] font-bold text-[#555] transition-all hover:bg-[#111] hover:text-[#CCC]"
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-[2px] overflow-hidden rounded-[28px] border border-[#141414] bg-[#141414]">
                {otherOptions.map((opt, idx) => (
                  <LandingReveal key={idx} delay={200 + (idx * 60)}>
                    <div className="group flex flex-col items-start justify-between gap-6 bg-[#050505] p-8 transition-all hover:bg-[#080808] sm:flex-row sm:items-center">
                      <div className="flex items-center gap-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[#141414] bg-[#0A0A0A] text-[15px] font-bold text-[#444] group-hover:bg-[#111]">
                           .{opt.extension}
                        </div>
                        <div className="space-y-1">
                            <span className="text-[19px] font-bold text-[#D1D1D1] group-hover:text-white transition-colors">
                            {opt.domain}
                            </span>
                            {opt.registryStatuses && opt.registryStatuses.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {opt.registryStatuses.map((s, i) => (
                                        <span key={i} className="text-[9px] font-bold text-[#444] uppercase tracking-tighter border border-[#141414] px-1.5 rounded-sm">
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="flex items-center gap-3">
                                <span className="inline-flex rounded-full bg-[#1e144a] px-2 py-0.5 text-[9px] font-bold uppercase text-[#7d66ff]">
                                    ECONOMIZE 50%
                                </span>
                                {opt.extension === 'ai' && <Sparkles className="h-3 w-3 text-[#7d66ff]" />}
                            </div>
                        </div>
                      </div>
                      
                      <div className="flex w-full items-center justify-between gap-10 sm:w-auto">
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-3">
                            <span className="text-[13px] text-[#333] line-through font-medium">R$ {(opt.price * 2.5).toFixed(2).replace('.', ',')}</span>
                            <span className="text-[19px] font-bold text-white tracking-tight">
                              R$ {opt.price.toFixed(2).replace('.', ',')}
                            </span>
                          </div>
                          <p className="text-[12px] font-medium text-[#444]">/1º ano à vista</p>
                        </div>
                        <LandingActionButton
                          variant="dark"
                          className="h-[46px] min-w-[140px] border border-[#1a1a1a] !bg-transparent text-[15px] hover:!bg-[#111] !px-4"
                          disabled={!opt.isAvailable}
                        >
                          {opt.isAvailable ? "Adquirir" : "Indisponível"}
                        </LandingActionButton>
                      </div>
                    </div>
                  </LandingReveal>
                ))}
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
