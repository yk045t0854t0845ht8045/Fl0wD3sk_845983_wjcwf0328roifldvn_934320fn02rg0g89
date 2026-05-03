type AdminPermissionGateProps = {
  permissions: string[];
  permission: string | string[];
  mode?: "all" | "any";
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

export function AdminPermissionGate({
  permissions,
  permission,
  mode = "all",
  fallback = null,
  children,
}: AdminPermissionGateProps) {
  const requiredPermissions = Array.isArray(permission) ? permission : [permission];
  const isAllowed =
    mode === "any"
      ? requiredPermissions.some((item) => permissions.includes(item))
      : requiredPermissions.every((item) => permissions.includes(item));

  if (!isAllowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
