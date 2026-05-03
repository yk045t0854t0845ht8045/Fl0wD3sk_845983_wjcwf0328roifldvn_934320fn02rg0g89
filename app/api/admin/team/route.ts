import { listAdminTeamMembers } from "@/lib/admin/read";
import { adminError, adminJson, requireAdminApiPermission } from "@/lib/admin/api";

export async function GET() {
  try {
    const access = await requireAdminApiPermission("team.read");
    if (!access.ok) {
      return access.response;
    }

    const staff = await listAdminTeamMembers();
    return adminJson({ ok: true, staff });
  } catch (error) {
    return adminError(error, "Erro ao carregar equipe administrativa.");
  }
}
