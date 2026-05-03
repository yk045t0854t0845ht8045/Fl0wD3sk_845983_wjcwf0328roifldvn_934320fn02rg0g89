import { listAdminAuditLogs } from "@/lib/admin/read";
import { adminError, adminJson, requireAdminApiPermission } from "@/lib/admin/api";

export async function GET(request: Request) {
  try {
    const access = await requireAdminApiPermission("audit.read");
    if (!access.ok) {
      return access.response;
    }

    const { searchParams } = new URL(request.url);
    const requestedLimit = Number(searchParams.get("limit") || "80");
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(200, requestedLimit))
      : 80;
    const logs = await listAdminAuditLogs(limit);

    return adminJson({ ok: true, logs });
  } catch (error) {
    return adminError(error, "Erro ao carregar logs administrativos.");
  }
}
