import {
  adminError,
  adminJson,
  requireAdminApiPermission,
} from "@/lib/admin/api";
import { listTestVariableReadLogs } from "@/lib/test-variables/service";

export async function GET() {
  try {
    const access = await requireAdminApiPermission("test_variables.view_logs");
    if (!access.ok) {
      return access.response;
    }

    const logs = await listTestVariableReadLogs(120);
    return adminJson({
      ok: true,
      logs,
    });
  } catch (error) {
    return adminError(error, "Erro ao carregar os logs de Test Variables.");
  }
}
