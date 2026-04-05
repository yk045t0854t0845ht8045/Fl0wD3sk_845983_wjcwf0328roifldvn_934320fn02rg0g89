"use client";

import { Cookie as CookieIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildCookieConsentPreferences,
  COOKIE_CONSENT_COOKIE_NAME,
  COOKIE_CONSENT_MAX_AGE_SECONDS,
  type CookieConsentPreferences,
  parseCookieConsent,
  REQUIRED_ONLY_COOKIE_CONSENT,
  serializeCookieConsent,
} from "@/lib/cookies/consent";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal/content";
import { useBodyScrollLock } from "@/lib/ui/useBodyScrollLock";

type CookieConsentManagerProps = {
  initialConsentValue?: string | null;
};

type CookieCategory = {
  key: "essential" | "preferences" | "analytics" | "marketing";
  title: string;
  description: string;
  helper: string;
  locked?: boolean;
};

const COOKIE_SHEET_EXIT_MS = 340;

const cookieCategories: CookieCategory[] = [
  {
    key: "essential",
    title: "Cookies obrigatorios",
    description:
      "Mantem login, seguranca da sessao, continuidade do checkout, protecao antifraude e o proprio registro desta escolha.",
    helper: "Sempre ativos para o sistema funcionar com seguranca.",
    locked: true,
  },
  {
    key: "preferences",
    title: "Cookies de preferencia",
    description:
      "Permitem lembrar ajustes opcionais de experiencia e interface quando esses recursos estiverem ativos.",
    helper: "Pode ser desativado sem impedir o uso principal da plataforma.",
  },
  {
    key: "analytics",
    title: "Cookies de analise",
    description:
      "Reservados para metricas tecnicas e leitura anonima de desempenho quando a Flowdesk ativar esses recursos.",
    helper: "Desativado por padrao.",
  },
  {
    key: "marketing",
    title: "Cookies de comunicacao",
    description:
      "Reservados para campanhas e comunicacoes promocionais futuras, caso esse tipo de recurso exista.",
    helper: "Desativado por padrao.",
  },
];

function CookieToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange?: (nextChecked: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onChange?.(!checked);
        }
      }}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
        checked
          ? "border-[#D8D8D8] bg-[#D8D8D8]"
          : "border-[#2E2E2E] bg-[#0A0A0A]"
      } ${
        disabled
          ? "cursor-not-allowed opacity-90"
          : "cursor-pointer hover:border-[#4A4A4A]"
      }`}
    >
      <span
        className={`block h-5 w-5 rounded-full transition ${
          checked ? "translate-x-6 bg-[#0A0A0A]" : "translate-x-1 bg-[#D8D8D8]"
        }`}
      />
    </button>
  );
}

export function CookieConsentManager({
  initialConsentValue,
}: CookieConsentManagerProps) {
  const pathname = usePathname();
  const bannerExitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalExitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [consent, setConsent] = useState<CookieConsentPreferences | null>(() =>
    parseCookieConsent(initialConsentValue),
  );
  const [draftConsent, setDraftConsent] = useState<CookieConsentPreferences>(() =>
    parseCookieConsent(initialConsentValue) ?? REQUIRED_ONLY_COOKIE_CONSENT,
  );
  const [isBannerExiting, setIsBannerExiting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isModalExiting, setIsModalExiting] = useState(false);

  useBodyScrollLock(isModalOpen);

  useEffect(() => {
    return () => {
      if (bannerExitTimeoutRef.current) {
        clearTimeout(bannerExitTimeoutRef.current);
      }

      if (modalExitTimeoutRef.current) {
        clearTimeout(modalExitTimeoutRef.current);
      }
    };
  }, []);

  const hasDecision = consent !== null;
  const bannerBottomClass = useMemo(() => {
    if (pathname.startsWith("/config") || pathname.startsWith("/servers")) {
      return "bottom-[74px] sm:bottom-[82px]";
    }

    return "bottom-5 sm:bottom-6";
  }, [pathname]);

  const persistConsent = useCallback((nextConsent: CookieConsentPreferences) => {
    const serialized = serializeCookieConsent(nextConsent);
    const secureAttribute =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "; Secure"
        : "";

    document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=${serialized}; Path=/; Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax; Priority=Low${secureAttribute}`;

    setConsent(nextConsent);
    setDraftConsent(nextConsent);

    window.dispatchEvent(
      new CustomEvent("flowdesk:cookie-consent-updated", {
        detail: nextConsent,
      }),
    );
  }, []);

  const closeModalImmediately = useCallback(() => {
    if (modalExitTimeoutRef.current) {
      clearTimeout(modalExitTimeoutRef.current);
      modalExitTimeoutRef.current = null;
    }

    setDraftConsent(consent ?? REQUIRED_ONLY_COOKIE_CONSENT);
    setIsModalExiting(false);
    setIsModalOpen(false);
  }, [consent]);

  const closeModal = useCallback(() => {
    if (!isModalOpen || isModalExiting) {
      return;
    }

    setIsModalExiting(true);
    modalExitTimeoutRef.current = setTimeout(() => {
      closeModalImmediately();
    }, COOKIE_SHEET_EXIT_MS);
  }, [closeModalImmediately, isModalExiting, isModalOpen]);

  const openModal = useCallback(() => {
    if (modalExitTimeoutRef.current) {
      clearTimeout(modalExitTimeoutRef.current);
      modalExitTimeoutRef.current = null;
    }

    setDraftConsent(consent ?? REQUIRED_ONLY_COOKIE_CONSENT);
    setIsModalExiting(false);
    setIsModalOpen(true);
  }, [consent]);

  const applyBannerConsent = useCallback(
    (nextConsent: CookieConsentPreferences) => {
      if (isBannerExiting) {
        return;
      }

      if (bannerExitTimeoutRef.current) {
        clearTimeout(bannerExitTimeoutRef.current);
      }

      setIsBannerExiting(true);
      bannerExitTimeoutRef.current = setTimeout(() => {
        persistConsent(nextConsent);
        setIsBannerExiting(false);
      }, COOKIE_SHEET_EXIT_MS);
    },
    [isBannerExiting, persistConsent],
  );

  const applyModalConsent = useCallback(
    (nextConsent: CookieConsentPreferences) => {
      if (isModalExiting) {
        return;
      }

      setIsModalExiting(true);
      modalExitTimeoutRef.current = setTimeout(() => {
        persistConsent(nextConsent);
        setIsModalExiting(false);
        setIsModalOpen(false);
      }, COOKIE_SHEET_EXIT_MS);
    },
    [isModalExiting, persistConsent],
  );

  const handleConfirmRequiredOnly = useCallback(() => {
    applyBannerConsent(buildCookieConsentPreferences(REQUIRED_ONLY_COOKIE_CONSENT));
  }, [applyBannerConsent]);

  const handleSaveRequiredOnly = useCallback(() => {
    applyModalConsent(buildCookieConsentPreferences(REQUIRED_ONLY_COOKIE_CONSENT));
  }, [applyModalConsent]);

  const handleSaveCustomConsent = useCallback(() => {
    applyModalConsent(buildCookieConsentPreferences(draftConsent));
  }, [applyModalConsent, draftConsent]);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeModal, isModalOpen]);

  return (
    <>
      {!hasDecision ? (
        <div
          className={`pointer-events-none fixed left-1/2 z-50 w-[min(1180px,calc(100vw-24px))] -translate-x-1/2 ${bannerBottomClass}`}
        >
          <div
            className={`pointer-events-auto relative w-full overflow-hidden rounded-[26px] shadow-[0_26px_90px_rgba(0,0,0,0.48)] backdrop-blur-[18px] ${
              isBannerExiting ? "flowdesk-sheet-down" : "flowdesk-sheet-up"
            }`}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[26px] border border-[#0E0E0E]"
            />
            <span
              aria-hidden="true"
              className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[26px]"
            />
            <span
              aria-hidden="true"
              className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[26px]"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-[1px] rounded-[25px] bg-[#070707]"
            />

            <div className="relative z-10 flex flex-col gap-[16px] px-[18px] py-[16px] sm:px-[22px] sm:py-[18px] xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-[14px]">
                <div className="inline-flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full border border-[#171717] bg-[#0D0D0D] text-[#D8D8D8]">
                  <CookieIcon className="h-[28px] w-[28px]" strokeWidth={2.2} aria-hidden="true" />
                </div>

                <div className="min-w-0 flex-1 self-center">
                  <p className="text-[23px] leading-[1] font-normal tracking-[-0.05em] text-[#EDEDED] sm:text-[20px]">
                    Sua experiencia fica melhor com cookies
                  </p>
                  <p className="mt-[8px] max-w-[760px] text-[12px] leading-[1.6] text-[#7F7F7F] sm:text-[12px]">
                    Seus dados, sua escolha. Usamos cookies para login,
                    seguranca e para melhorar como a Flowdesk funciona
                    aqui dentro.
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-col-reverse gap-[10px] sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={openModal}
                  disabled={isBannerExiting}
                  className="group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-[12px] bg-[#111111] transition-colors"
                  />
                  <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap text-[#D0D0D0]">
                    Ver mais
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleConfirmRequiredOnly}
                  disabled={isBannerExiting}
                  className="group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-[12px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                  />
                  <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap text-[#282828]">
                    Confirmar cookies
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isModalOpen ? (
        <div
          className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-black/72 px-3 py-6 backdrop-blur-md sm:px-5"
          onClick={closeModal}
        >
          <div className="flex min-h-full items-center justify-center">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Preferencias de cookies"
              onClick={(event) => event.stopPropagation()}
              className={`relative w-full max-w-[760px] overflow-hidden rounded-[26px] shadow-[0_26px_90px_rgba(0,0,0,0.48)] backdrop-blur-[18px] ${
                isModalExiting ? "flowdesk-sheet-down" : "flowdesk-sheet-up"
              }`}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[26px] border border-[#0E0E0E]"
              />
              <span
                aria-hidden="true"
                className="flowdesk-tag-border-glow pointer-events-none absolute inset-[-2px] rounded-[26px]"
              />
              <span
                aria-hidden="true"
                className="flowdesk-tag-border-core pointer-events-none absolute inset-[-1px] rounded-[26px]"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-[1px] rounded-[25px] bg-[#070707]"
              />

              <div className="thin-scrollbar relative z-10 max-h-[calc(100vh-48px)] overflow-y-auto overscroll-contain px-[18px] py-[16px] sm:px-[22px] sm:py-[18px]">
                <div className="flex flex-col gap-[14px] sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.18em] uppercase text-[#6D6D6D]">
                      Preferencias de cookies
                    </p>
                    <h2 className="mt-[10px] text-[28px] leading-[0.98] font-normal tracking-[-0.05em] text-[#EDEDED] sm:text-[34px]">
                      Ajuste sua escolha
                    </h2>
                    <p className="mt-[12px] max-w-[560px] text-[13px] leading-[1.65] text-[#7F7F7F]">
                      Os cookies obrigatorios continuam ativos porque sustentam
                      autenticacao, seguranca, reconciliacao de pagamentos e
                      estabilidade do painel. Os demais podem ficar ligados ou
                      desligados conforme a sua preferencia.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={closeModal}
                    className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#171717] bg-[#0D0D0D] text-[#9C9C9C] transition-colors hover:border-[#242424] hover:text-[#E4E4E4]"
                    aria-label="Fechar configuracao de cookies"
                  >
                    <span className="text-[18px] leading-none">X</span>
                  </button>
                </div>

                <div className="mt-[22px] space-y-[12px]">
                  {cookieCategories.map((category) => {
                    const checked =
                      category.key === "essential"
                        ? true
                        : draftConsent[category.key];

                    return (
                      <div
                        key={category.key}
                        className="rounded-[20px] border border-[#171717] bg-[linear-gradient(180deg,rgba(10,10,10,0.98)_0%,rgba(7,7,7,0.98)_100%)] px-[18px] py-[16px]"
                      >
                        <div className="flex flex-col gap-[14px] sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-[8px]">
                            <div className="flex flex-wrap items-center gap-[8px]">
                              <span className="text-[15px] font-medium text-[#E7E7E7]">
                                {category.title}
                              </span>
                              {category.locked ? (
                                <span className="rounded-full border border-[#3A3A3A] bg-[#111111] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[#9C9C9C]">
                                  Sempre ativo
                                </span>
                              ) : null}
                            </div>
                            <p className="text-[12px] leading-[1.7] text-[#A1A1A1]">
                              {category.description}
                            </p>
                            <p className="text-[11px] leading-[1.6] text-[#717171]">
                              {category.helper}
                            </p>
                          </div>

                          <CookieToggle
                            checked={checked}
                            disabled={category.locked}
                            onChange={(nextChecked) => {
                              setDraftConsent((current) =>
                                buildCookieConsentPreferences({
                                  ...current,
                                  [category.key]: nextChecked,
                                }),
                              );
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-[18px] rounded-[20px] border border-[#171717] bg-[#0B0B0B] px-[18px] py-[16px]">
                  <p className="text-[12px] font-medium text-[#D9D9D9]">
                    Informacoes importantes
                  </p>
                  <div className="mt-[8px] space-y-[8px] text-[11px] leading-[1.7] text-[#8B8B8B] sm:text-[12px]">
                    <p>
                      Os cookies obrigatorios suportam login, sessao
                      autenticada, fluxo de pagamentos, antifraude e
                      estabilidade das paginas.
                    </p>
                    <p>
                      Consulte{" "}
                      <Link
                        href={TERMS_PATH}
                        className="text-[#D8D8D8] underline underline-offset-4 transition hover:text-white"
                      >
                        termos
                      </Link>{" "}
                      e{" "}
                      <Link
                        href={PRIVACY_PATH}
                        className="text-[#D8D8D8] underline underline-offset-4 transition hover:text-white"
                      >
                        politica de privacidade
                      </Link>{" "}
                      para detalhes sobre dados e operacao do painel.
                    </p>
                  </div>
                </div>

                <div className="mt-[18px] flex flex-col gap-[10px] sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={handleSaveRequiredOnly}
                    disabled={isModalExiting}
                    className="group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[12px] border border-[#1B1B1B] bg-[#111111] transition-colors"
                    />
                    <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap text-[#D0D0D0]">
                      Somente obrigatorios
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveCustomConsent}
                    disabled={isModalExiting}
                    className="group relative inline-flex h-[46px] items-center justify-center overflow-hidden whitespace-nowrap rounded-[12px] px-6 text-[15px] leading-none font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[12px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                    />
                    <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap text-[#282828]">
                      Salvar preferencias
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
