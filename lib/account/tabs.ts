export type AccountTab =
  | "overview"
  | "plans"
  | "payment_methods"
  | "payment_history"
  | "api_keys"
  | "teams"
  | "tickets"
  | "status"
  | "delete_account";

export const ACCOUNT_TABS: AccountTab[] = [
  "overview",
  "plans",
  "payment_methods",
  "payment_history",
  "api_keys",
  "teams",
  "tickets",
  "status",
  "delete_account"
];

export function validateTab(tab: string | undefined): AccountTab {
  if (ACCOUNT_TABS.includes(tab as AccountTab)) return tab as AccountTab;
  return "overview";
}
