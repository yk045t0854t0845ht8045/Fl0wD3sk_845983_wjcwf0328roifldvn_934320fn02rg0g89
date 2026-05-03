import {
  adminError,
  adminJson,
  requireAdminApiPermission,
} from "@/lib/admin/api";
import { listPendingDevIpRequests } from "@/lib/test-variables/service";

export async function GET() {
  try {
    const access = await requireAdminApiPermission("test_variables.approve_ip");
    if (!access.ok) {
      return access.response;
    }

    const requests = await listPendingDevIpRequests();
    return adminJson({
      ok: true,
      requests,
    });
  } catch (error) {
    return adminError(error, "Erro ao carregar a fila de aprovacoes FLWIP.");
  }
}
