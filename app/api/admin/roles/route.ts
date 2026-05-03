import { listAdminRoles } from "@/lib/admin/read";
import { adminError, adminJson, requireAdminApiPermission } from "@/lib/admin/api";

export async function GET() {
  try {
    const access = await requireAdminApiPermission("roles.read");
    if (!access.ok) {
      return access.response;
    }

    const roles = await listAdminRoles();
    return adminJson({ ok: true, roles });
  } catch (error) {
    return adminError(error, "Erro ao carregar cargos administrativos.");
  }
}
