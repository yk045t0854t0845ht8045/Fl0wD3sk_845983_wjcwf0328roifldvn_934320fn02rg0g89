/**
 * OpenProvider REST API - Type Definitions
 */

export interface OpenProviderError {
  desc: string;
  code: number;
}

export interface DomainCheckItem {
  name: string;
  extension: string;
}

export interface DomainCheckRequest {
  domains: DomainCheckItem[];
  additional_data?: {
    idn_script?: string;
  };
  withPrice?: boolean;
}

export interface DomainCheckResult {
  domain: {
    name: string;
    extension: string;
  };
  status: "free" | "active" | "taken" | "unknown";
  price?: {
    reseller?: {
      price: number;
      currency: string;
    };
  };
  isPremium?: boolean;
}

export interface DomainCheckResponse {
  code: number;
  desc?: string;
  maintenance?: boolean;
  data: {
    results: DomainCheckResult[];
  };
}
