import { headers } from "next/headers";
import { AppMaintenanceScreen } from "@/components/common/AppMaintenanceScreen";
import {
  getMaintenanceContent,
  isMaintenanceEnabled,
  shouldBypassMaintenanceForHost,
  type MaintenanceArea,
} from "@/lib/maintenance";

type MaintenanceGateProps = {
  area: MaintenanceArea;
  children: React.ReactNode;
};

export async function MaintenanceGate({
  area,
  children,
}: MaintenanceGateProps) {
  const requestHeaders = await headers();
  const requestHost =
    requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");

  if (shouldBypassMaintenanceForHost(requestHost)) {
    return <>{children}</>;
  }

  if (!isMaintenanceEnabled(area)) {
    return <>{children}</>;
  }

  const content = getMaintenanceContent(area);

  return (
    <AppMaintenanceScreen
      title={content.title}
      description={content.description}
      fallbackHref={content.fallbackHref}
    />
  );
}
