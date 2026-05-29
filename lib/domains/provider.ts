import type { DomainProviderAdapter } from "./adapter";
import { namesiloAdapter } from "./namesiloAdapter";

export type SupportedDomainProvider = "namesilo";

const DEFAULT_PROVIDER: SupportedDomainProvider = "namesilo";

export function getActiveDomainProviderName(): SupportedDomainProvider {
  const raw = (process.env.DOMAIN_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  if (raw === "namesilo") return "namesilo";
  return DEFAULT_PROVIDER;
}

export function getActiveDomainProvider(): DomainProviderAdapter {
  // Fluxo atual: NameSilo como registradora oficial.
  return namesiloAdapter;
}
