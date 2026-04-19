import {
  buildConfigCheckoutPath,
  type PlanBillingPeriodCode,
  type PlanCode,
} from "@/lib/plans/catalog";

type ConfigCheckoutQueryValue = string | number | boolean | null | undefined;
type ConfigCheckoutQueryValueInput =
  | ConfigCheckoutQueryValue
  | ConfigCheckoutQueryValue[];

function isNullishSearchParamString(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "null" ||
    normalized === "undefined" ||
    normalized === "nan"
  );
}

function normalizeSearchParamValues(value: ConfigCheckoutQueryValueInput) {
  const values = Array.isArray(value) ? value : [value];
  const normalizedValues: string[] = [];

  for (const item of values) {
    if (item === null || typeof item === "undefined") continue;

    const normalizedValue =
      typeof item === "boolean" ? (item ? "1" : "0") : String(item).trim();

    if (isNullishSearchParamString(normalizedValue)) continue;
    normalizedValues.push(normalizedValue);
  }

  return normalizedValues;
}

export function buildConfigCheckoutSearchParams(input?: {
  searchParams?: URLSearchParams | Record<string, ConfigCheckoutQueryValueInput>;
  omitKeys?: string[];
}) {
  const source = input?.searchParams;
  const params = new URLSearchParams();

  if (!source) return params;

  const omitKeys = new Set(
    (input?.omitKeys || []).map((key) => key.trim().toLowerCase()).filter(Boolean),
  );

  if (source instanceof URLSearchParams) {
    for (const [key, value] of source.entries()) {
      if (omitKeys.has(key.trim().toLowerCase())) continue;

      const normalizedValue = value.trim();
      if (isNullishSearchParamString(normalizedValue)) continue;
      params.append(key, normalizedValue);
    }

    return params;
  }

  for (const [key, value] of Object.entries(source)) {
    if (omitKeys.has(key.trim().toLowerCase())) continue;

    const normalizedValues = normalizeSearchParamValues(value);
    for (const normalizedValue of normalizedValues) {
      params.append(key, normalizedValue);
    }
  }

  return params;
}

export function normalizeConfigHashRoute(hash: string | null | undefined) {
  if (typeof hash !== "string") return "";

  const trimmedHash = hash.trim();
  if (!trimmedHash) return "";

  const prefixedHash = trimmedHash.startsWith("#") ? trimmedHash : `#${trimmedHash}`;
  const routeMatch = prefixedHash.match(/^#\/(?:payment|step\/[1-4])(?:\?[^#]*)?/i);
  const normalizedHash = routeMatch ? routeMatch[0] : prefixedHash;

  return normalizedHash.replace(/\/+$/, "");
}

export function buildConfigUrlWithHashRoute(
  pathname: string,
  search = "",
  hash = "",
) {
  const normalizedHash = normalizeConfigHashRoute(hash);
  const normalizedSearch = search
    ? search.startsWith("?")
      ? search
      : `?${search}`
    : "";
  const normalizedPathname =
    normalizedHash.startsWith("#/") && pathname !== "/" && !pathname.endsWith("/")
      ? `${pathname}/`
      : pathname;

  return `${normalizedPathname}${normalizedSearch}${normalizedHash}`;
}

export function buildConfigCheckoutEntryHref(input: {
  planCode?: unknown;
  billingPeriodCode?: unknown;
  fallbackPlanCode?: PlanCode;
  fallbackBillingPeriodCode?: PlanBillingPeriodCode;
  searchParams?: URLSearchParams | Record<string, ConfigCheckoutQueryValueInput>;
  omitSearchParamKeys?: string[];
  hash?: string | null;
}) {
  const pathname = buildConfigCheckoutPath({
    planCode: input.planCode,
    billingPeriodCode: input.billingPeriodCode,
    fallbackPlanCode: input.fallbackPlanCode,
    fallbackBillingPeriodCode: input.fallbackBillingPeriodCode,
  });
  const params = buildConfigCheckoutSearchParams({
    searchParams: input.searchParams,
    omitKeys: input.omitSearchParamKeys,
  });

  return buildConfigUrlWithHashRoute(
    pathname,
    params.toString(),
    input.hash || "",
  );
}
