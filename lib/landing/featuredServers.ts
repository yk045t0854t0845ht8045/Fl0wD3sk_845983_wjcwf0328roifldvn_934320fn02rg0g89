export const FEATURED_SERVER_IDS = [
  "1353259338759671838",
  "1467347653997363282",
  "1473881171778732033",
  "579020662413459466",
  "981036754599559169",
  "1250153563947274320",
] as const;

export function isFeaturedServerId(serverId: string) {
  return FEATURED_SERVER_IDS.includes(
    serverId as (typeof FEATURED_SERVER_IDS)[number],
  );
}
