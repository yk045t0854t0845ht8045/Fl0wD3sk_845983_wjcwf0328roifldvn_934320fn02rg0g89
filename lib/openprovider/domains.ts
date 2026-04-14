import { openProviderClient } from "./client";
import { DomainCheckResponse } from "./types";

/**
 * Domain Check Interface
 */
export interface CheckDomainInput {
  name: string;
  extension: string;
  idn_script?: string;
}

/**
 * Checks domain availability via OpenProvider REST API.
 * Supports IDN scripts via additional_data.
 * 
 * @param domains List of domains to check { name, extension, idn_script? }
 * @returns Normalized results from OpenProvider
 */
export async function checkDomains(domains: CheckDomainInput[]) {
  // Extract IDN script if any (OpenProvider usually expects consistent scripts per batch or specific handled scripts)
  const idnScript = domains.find(d => d.idn_script)?.idn_script;

  const payload: any = {
    domains: domains.map(({ name, extension }) => ({ name, extension })),
    withPrice: true,
    with_additional_data: true,
    with_registry_statuses: true,
  };

  if (idnScript) {
    payload.additional_data = {
      idn_script: idnScript
    };
  }

  try {
    const response = await openProviderClient.post<DomainCheckResponse>("domains/check", payload);
    
    // Normalization logic
    return response.data.results.map((res: any) => ({
      domain: `${res.domain.name}.${res.domain.extension}`,
      extension: res.domain.extension,
      isAvailable: res.status === "free",
      status: res.status,
      price: res.price?.reseller?.price || 0,
      currency: res.price?.reseller?.currency || "BRL",
      isPremium: res.isPremium || false,
      registryStatuses: res.registry_statuses || []
    }));
  } catch (error) {
    throw error;
  }
}

/**
 * Why IDN scripts?
 * Internationalized Domain Names (IDNs) like "música.com" require specific scripts 
 * (e.g., LATN for Latin, CYRL for Cyrillic) so the registry knows how to encode
 * the Punycode (xn--m sica-0ta.com) correctly.
 */
