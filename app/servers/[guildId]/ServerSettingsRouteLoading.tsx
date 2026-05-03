type ServerSettingsSection =
  | "overview"
  | "message"
  | "sales_overview"
  | "sales_categories"
  | "sales_category_create"
  | "sales_category_edit"
  | "sales_products"
  | "sales_product_create"
  | "sales_product_edit"
  | "sales_payment_methods"
  | "sales_coupons_gifts"
  | "entry_exit_overview"
  | "entry_exit_message"
  | "security_antilink"
  | "security_autorole"
  | "security_logs"
  | "ticket_ai";

type ServerSettingsRouteLoadingProps = {
  settingsSection: ServerSettingsSection;
};

export function ServerSettingsRouteLoading({
  settingsSection,
}: ServerSettingsRouteLoadingProps) {
  void settingsSection;
  return null;
}
