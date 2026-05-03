import { redirect } from "next/navigation";
import { AdminAccessState } from "@/components/admin/AdminAccessState";
import { AdminShell } from "@/components/admin/AdminShell";
import { MaintenanceGate } from "@/components/common/MaintenanceGate";
import {
  describeCurrentAdminRole,
  getCurrentAdminProfile,
} from "@/lib/admin/auth";
import { touchAdminSession } from "@/lib/admin/audit";
import { buildLoginHref } from "@/lib/auth/paths";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";

function getAdminSetupErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  const normalizedMessage = error.message.toLowerCase();
  if (
    normalizedMessage.includes("admin_") ||
    normalizedMessage.includes("dev_") ||
    normalizedMessage.includes("test_variable") ||
    normalizedMessage.includes("pgrst") ||
    normalizedMessage.includes("relation")
  ) {
    return error.message;
  }

  return null;
}

async function AdminLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentAuthSessionFromCookie();

  if (!session) {
    redirect(buildLoginHref("/admin"));
  }

  let profile = null;

  try {
    profile = await getCurrentAdminProfile();
  } catch (error) {
    const setupMessage = getAdminSetupErrorMessage(error);
    if (setupMessage) {
      return (
        <AdminAccessState
          badgeLabel="Setup necessario"
          title="Camada administrativa aguardando schema"
          description={`O painel admin depende das migrations novas de RBAC/FLWIP/Test Variables. Detalhe tecnico capturado: ${setupMessage}`}
        />
      );
    }

    throw error;
  }

  if (!profile || !profile.permissions.includes("admin.access")) {
    return (
      <AdminAccessState
        badgeLabel="Acesso restrito"
        title="Sua conta nao possui acesso administrativo"
        description="O login foi reconhecido, mas nao existe um perfil administrativo ativo com a permissao `admin.access` para esta sessao."
      />
    );
  }

  try {
    await touchAdminSession({
      authSessionId: profile.session.id,
      authUserId: profile.session.user.id,
      staffProfileId: profile.staffProfile.id,
    });
  } catch (error) {
    console.error("[Admin] Failed to touch admin session:", error);
  }

  return (
    <AdminShell
      profile={{
        displayName: profile.staffProfile.displayName,
        email: profile.staffProfile.email,
        primaryRole: describeCurrentAdminRole(profile),
        permissionCount: profile.permissions.length,
        permissions: profile.permissions,
      }}
    >
      {children}
    </AdminShell>
  );
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MaintenanceGate area="admin">
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </MaintenanceGate>
  );
}
