import Link from "next/link";
import { AdminCertificateActions } from "@/components/admin/AdminCertificateActions";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";
import { listDevCertificates } from "@/lib/test-variables/service";

export default async function AdminTestVariableCertificatesPage() {
  const profile = await requirePermission("test_variables.read");
  const certificates = await listDevCertificates();
  const canRevoke = profile.permissions.includes("test_variables.revoke_flwip");

  return (
    <div className="space-y-[22px]">
      <AdminPageHeader
        eyebrow="Dev Environment"
        title="Certificados FLWIP"
        description="Visao consolidada de certificados ativos, expirados ou revogados com fingerprint, ambiente, ultima utilizacao e estado atual."
        actions={
          <Link
            href="/admin/test-variables"
            className="rounded-[14px] border border-[#1B1B1B] bg-[#101010] px-[14px] py-[11px] text-[13px] font-medium text-[#E5E5E5] transition-colors hover:border-[#262626] hover:bg-[#141414]"
          >
            Voltar ao catalogo
          </Link>
        }
      />

      <AdminDataTable
        title="Certificados emitidos"
        description="O painel exibe o estado atual e a ultima atividade conhecida sem expor nenhum token sensivel ao operador."
        headers={["Fingerprint", "Usuario", "Ambiente", "Validade", "Status"]}
        rows={certificates.map((certificate) => [
          <div key={`${certificate.id}-fingerprint`} className="space-y-[4px]">
            <p className="font-medium text-[#F0F0F0]">{certificate.fingerprint}</p>
            <p className="text-[12px] text-[#6B6B6B]">{certificate.projectId}</p>
          </div>,
          <p key={`${certificate.id}-user`} className="text-[#E5E5E5]">
            Usuario #{certificate.authUserId}
          </p>,
          <p key={`${certificate.id}-environment`} className="text-[#E5E5E5]">
            {certificate.environment}
          </p>,
          <div key={`${certificate.id}-expiry`} className="space-y-[4px] text-[12px] text-[#8A8A8A]">
            <p>{new Date(certificate.expiresAt).toLocaleString("pt-BR")}</p>
            <p>
              {certificate.lastUsedAt
                ? `Ultimo uso em ${new Date(certificate.lastUsedAt).toLocaleString("pt-BR")}`
                : "Sem uso registrado"}
            </p>
          </div>,
          <AdminStatusBadge key={`${certificate.id}-status`} status={certificate.status} />,
        ])}
        emptyState={
          <AdminEmptyState
            badgeLabel="Sem FLWIP"
            title="Nenhum certificado emitido"
            description="Os certificados FLWIP vao aparecer aqui assim que a primeira aprovacao for concluida."
          />
        }
      />

      {canRevoke && certificates.some((certificate) => certificate.status === "active") ? (
        <AdminCertificateActions certificates={certificates} />
      ) : null}
    </div>
  );
}
