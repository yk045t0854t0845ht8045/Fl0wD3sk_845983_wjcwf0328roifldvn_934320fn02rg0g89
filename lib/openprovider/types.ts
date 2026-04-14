export interface OpenProviderWarning {
  code?: number;
  desc?: string;
  data?: unknown;
}

export interface OpenProviderErrorPayload {
  code?: number;
  desc?: string;
  data?: unknown;
  maintenance?: boolean;
  warnings?: OpenProviderWarning[];
}

export interface OpenProviderApiResponse<TData> extends OpenProviderErrorPayload {
  data?: TData;
}

export interface AuthLoginResponseData {
  reseller_id?: number;
  token?: string;
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
  with_price?: boolean;
}

export interface DomainPriceValue {
  price?: number;
  currency?: string;
}

export interface DomainPriceGroup {
  product?: DomainPriceValue;
  reseller?: DomainPriceValue;
}

export interface DomainPremiumPrice {
  currency?: string;
  price?: {
    create?: number;
  };
}

export interface DomainCheckResult {
  claim_key?: string;
  domain: string;
  is_premium?: boolean;
  premium?: DomainPremiumPrice;
  price?: DomainPriceGroup;
  reason?: string;
  status?: string;
  whois?: string;
}

export interface DomainCheckResponseData {
  results?: DomainCheckResult[];
}

export interface DomainPriceResponseData {
  is_premium?: boolean;
  is_promotion?: boolean;
  price?: DomainPriceGroup;
  tier_price?: DomainPriceGroup;
  membership_price?: DomainPriceGroup;
}

export interface DomainSearchResult {
  domain: string;
  extension: string;
  status: string;
  isAvailable: boolean;
  price: number;
  currency: string;
  isPremium: boolean;
  reason: string;
  whois: string;
}

export interface DomainSearchResponse {
  query: string;
  baseName: string;
  exactDomain: string | null;
  searchedTlds: string[];
  results: DomainSearchResult[];
}
