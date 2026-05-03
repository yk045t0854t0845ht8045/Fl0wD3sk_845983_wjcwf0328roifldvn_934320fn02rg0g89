import { KeyRound, LockKeyhole, Settings2, ShieldCheck } from "lucide-react";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatCard } from "@/components/admin/AdminStatCard";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { requirePermission } from "@/lib/admin/auth";

function envStatus(name: string) {
  return process.env[name] ? "active" : "pending";
}

export default async function AdminSettingsPage() {
  await requirePermission("settings.read");

  const settingsRows = [
    {
      key: "FLOWDESK_BOOTSTRAP_ADMIN_EMAIL",
      label: "Bootstrap do primeiro CEO",
      description:
        "Usado apenas para promover com seguranca o primeiro admin institucional.",
    },
    {
      key: "FLOWSECURE_MASTER_KEY",
      label: "Criptografia principal",
      description:
        "Base usada pelo FlowSecure para proteger segredos, tokens e test variables.",
    },
    {
      key: "NEXT_PUBLIC_SITE_URL",
      label: "Host canonico publico",
      description:
        "Mantem coerencia de links, callbacks e roteamento cross-subdomain.",
    },
    {
      key: "NEXT_PUBLIC_STATUS_URL",
      label: "Host do status",
      description:
        "Consumido pelo ecossistema publico e pelo monitoramento institucional.",
    },
  ];

  const configuredCount = settingsRows.filter((row) => process.env[row.key]).length;

  return (
    <section className="min-w-0">
      <AdminPageHeader
        eyebrow="Governanca"
        title="Configuracoes"
        description="Painel de prontidao operacional para variaveis estruturais do admin, FlowSecure e hosts canonicos. Nenhum segredo e exibido, apenas o estado de configuracao."
      />

      <div className="mt-[24px] grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Itens monitorados"
          value={String(settingsRows.length)}
          description="Conjunto minimo de configuracoes sensiveis desta camada."
          icon={<Settings2 className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Configurados"
          value={String(configuredCount)}
          description="Entradas presentes no ambiente atual."
          icon={<ShieldCheck className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="Fluxo bootstrap"
          value={process.env.FLOWDESK_BOOTSTRAP_ADMIN_EMAIL ? "Pronto" : "Pendente"}
          description="Status do mecanismo seguro de promocao inicial."
          icon={<KeyRound className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
        <AdminStatCard
          label="FlowSecure"
          value={
            process.env.FLOWSECURE_MASTER_KEY || process.env.FLOWSECURE_MASTER_SECRET
              ? "Pronto"
              : "Pendente"
          }
          description="Disponibilidade do segredo principal para criptografia institucional."
          icon={<LockKeyhole className="h-[20px] w-[20px]" strokeWidth={1.9} />}
        />
      </div>

      <div className="mt-[18px]">
        <AdminDataTable
          title="Prontidao de ambiente"
          description="A tabela valida somente a presenca das configuracoes. Valores completos nunca sao exibidos no painel."
          headers={["Variavel", "Papel", "Status"]}
          rows={settingsRows.map((row) => [
            <div key={row.key} className="space-y-[6px]">
              <p className="font-medium text-[#EFEFEF]">{row.key}</p>
              <p className="text-[12px] text-[#6D6D6D]">{row.label}</p>
            </div>,
            <p key={`${row.key}-description`} className="max-w-[420px] text-[13px] leading-[1.6] text-[#CFCFCF]">
              {row.description}
            </p>,
            <AdminStatusBadge
              key={`${row.key}-status`}
              status={envStatus(row.key)}
              label={process.env[row.key] ? "Configurado" : "Nao configurado"}
            />,
          ])}
        />
      </div>
    </section>
  );
}
