import {
  adminError,
  adminJson,
  requireAdminApiPermission,
} from "@/lib/admin/api";
import { listDevCertificates } from "@/lib/test-variables/service";

export async function GET() {
  try {
    const access = await requireAdminApiPermission("test_variables.read");
    if (!access.ok) {
      return access.response;
    }

    const certificates = await listDevCertificates();
    return adminJson({
      ok: true,
      certificates,
    });
  } catch (error) {
    return adminError(error, "Erro ao carregar os certificados FLWIP.");
  }
}
