import { listAdminPermissions } from "@/lib/admin/read";
import { adminError, adminJson, requireAdminApiPermission } from "@/lib/admin/api";

export async function GET() {
  try {
    const access = await requireAdminApiPermission("permissions.read");
    if (!access.ok) {
      return access.response;
    }

    const permissions = await listAdminPermissions();
    return adminJson({ ok: true, permissions });
  } catch (error) {
    return adminError(error, "Erro ao carregar permissoes administrativas.");
  }
}
