import { notFound, redirect } from "next/navigation";
import { AppMaintenanceScreen } from "@/components/common/AppMaintenanceScreen";
import { VpsWorkspace, type VpsWorkspaceSnapshot } from "@/components/hosting/VpsWorkspace";
import { buildLoginHref } from "@/lib/auth/paths";
import { getCurrentUserFromSessionCookieSafe } from "@/lib/auth/session";
import {
  HOSTING_PLANS,
  HOSTING_REGIONS,
  getHostingKindLabel,
  type HostingKind,
} from "@/lib/hosting/catalog";
import { resolveRuntimeStatus } from "@/lib/hosting/vpsRuntime";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

type VpsPanelPageProps = {
  params: Promise<{
    code: string;
  }>;
};

type HostingProjectRow = {
  id: number;
  vps_code: string;
  user_id: number;
  payment_order_id: number | null;
  hosting_kind: HostingKind;
  hosting_plan_id: string;
  hosting_region_id: string;
  github_owner: string;
  github_repo: string;
  github_repo_id: string | null;
  github_branch: string;
  status: string;
  runtime_status: string | null;
  runtime_status_payload: unknown;
  runtime_last_seen_at: string | null;
  windows_runtime: string;
  provisioning_payload: unknown;
  created_at: string;
  updated_at: string;
};

type PaymentOrderRow = {
  id: number;
  order_number: number;
  status: string;
  amount: number;
  currency: string;
  payment_method: string | null;
  provider_payment_id: string | null;
  provider_status: string | null;
  paid_at: string | null;
  created_at: string;
  provider_payload: unknown;
};

type RepositorySnapshot = {
  owner: string;
  name: string;
  fullName: string;
  branch: string;
  id: string | null;
  description: string | null;
  language: string | null;
  htmlUrl: string;
  private: boolean | null;
};

function normalizeVpsCode(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    normalized,
  )
    ? normalized
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRecord(value: unknown, key: string) {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatMoney(amount: number | null | undefined, currency = "BRL") {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "Pendente";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.round(amount * 100) / 100);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Pendente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pendente";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function resolvePayloadRepository(project: HostingProjectRow): RepositorySnapshot {
  const payloadRepository = readRecord(project.provisioning_payload, "repository");
  const owner = readString(payloadRepository?.owner) || project.github_owner;
  const name = readString(payloadRepository?.name) || project.github_repo;
  const fullName =
    readString(payloadRepository?.fullName) ||
    readString(payloadRepository?.full_name) ||
    `${owner}/${name}`;
  const branch = readString(payloadRepository?.branch) || project.github_branch;
  const htmlUrl =
    readString(payloadRepository?.htmlUrl) ||
    readString(payloadRepository?.html_url) ||
    `https://github.com/${fullName}`;

  return {
    owner,
    name,
    fullName,
    branch,
    id: readString(payloadRepository?.id) || project.github_repo_id,
    description: readString(payloadRepository?.description),
    language: readString(payloadRepository?.language),
    htmlUrl,
    private:
      typeof payloadRepository?.private === "boolean"
        ? payloadRepository.private
        : null,
  };
}

function resolvePurchaseContext(value: unknown) {
  const context = readRecord(value, "purchase_context");
  return context;
}

export default async function VpsPanelPage({ params }: VpsPanelPageProps) {
  const { code: rawCode } = await params;
  const code = normalizeVpsCode(rawCode);
  if (!code) notFound();

  const sessionResult = await getCurrentUserFromSessionCookieSafe({
    fullContext: true,
  });

  if (sessionResult.degraded) {
    return (
      <AppMaintenanceScreen
        badgeLabel="Painel VPS"
        title="Painel temporariamente indisponivel"
        description="Estamos restabelecendo a conexao com a base antes de abrir sua VPS."
        refreshLabel="Tentar novamente"
        fallbackHref="/dashboard/hosting"
      />
    );
  }

  const user = sessionResult.user;
  if (!user) {
    redirect(buildLoginHref(`/vps/${code}`));
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const { data: project, error } = await supabase
    .from("hosting_projects")
    .select(
      "id, vps_code, user_id, payment_order_id, hosting_kind, hosting_plan_id, hosting_region_id, github_owner, github_repo, github_repo_id, github_branch, status, runtime_status, runtime_status_payload, runtime_last_seen_at, windows_runtime, provisioning_payload, created_at, updated_at",
    )
    .eq("vps_code", code)
    .eq("user_id", user.id)
    .maybeSingle<HostingProjectRow>();

  if (error) {
    return (
      <AppMaintenanceScreen
        badgeLabel="Painel VPS"
        title="Nao conseguimos abrir esta VPS"
        description={error.message}
        refreshLabel="Tentar novamente"
        fallbackHref="/dashboard/hosting"
      />
    );
  }

  if (!project) notFound();

  const { data: paymentOrder } = project.payment_order_id
    ? await supabase
        .from("payment_orders")
        .select(
          "id, order_number, status, amount, currency, payment_method, provider_payment_id, provider_status, paid_at, created_at, provider_payload",
        )
        .eq("id", project.payment_order_id)
        .eq("user_id", user.id)
        .maybeSingle<PaymentOrderRow>()
    : { data: null };

  const payloadPlan = readRecord(project.provisioning_payload, "plan");
  const payloadRegion = readRecord(project.provisioning_payload, "region");
  const purchaseContext = resolvePurchaseContext(paymentOrder?.provider_payload);
  const repository = resolvePayloadRepository(project);
  const catalogPlan =
    HOSTING_PLANS[project.hosting_kind]?.find(
      (item) => item.id === project.hosting_plan_id,
    ) || null;
  const plan = catalogPlan
    ? {
        ...catalogPlan,
        name: readString(payloadPlan?.name) || catalogPlan.name,
        monthlyAmount:
          readNumber(payloadPlan?.monthlyAmount) ??
          readNumber(purchaseContext?.amount) ??
          catalogPlan.monthlyAmount,
        currency:
          readString(payloadPlan?.currency) ||
          readString(purchaseContext?.currency) ||
          catalogPlan.currency,
        specs: Array.isArray(payloadPlan?.specs)
          ? payloadPlan.specs.filter((item): item is string => typeof item === "string")
          : catalogPlan.specs,
      }
    : null;
  const catalogRegion =
    HOSTING_REGIONS.find((item) => item.id === project.hosting_region_id) ||
    HOSTING_REGIONS[0];
  const region = {
    ...catalogRegion,
    name: readString(payloadRegion?.name) || catalogRegion.name,
    country: readString(payloadRegion?.country) || catalogRegion.country,
    city: readString(payloadRegion?.city) || catalogRegion.city,
    pingMs: readNumber(payloadRegion?.pingMs) ?? catalogRegion.pingMs,
  };
  const repoName = repository.fullName;
  const paymentLabel = paymentOrder
    ? `Pedido #${paymentOrder.order_number}`
    : "Pedido vinculado";
  const paymentAmount = paymentOrder
    ? formatMoney(paymentOrder.amount, paymentOrder.currency)
    : formatMoney(plan?.monthlyAmount, plan?.currency);
  const runtimePayload = isRecord(project.runtime_status_payload)
    ? project.runtime_status_payload
    : {};
  const fileTree = Array.isArray(runtimePayload.fileTree)
    ? runtimePayload.fileTree
    : [];

  const snapshot: VpsWorkspaceSnapshot = {
    project: {
      vpsCode: code,
      status: project.status,
      runtimeStatus: resolveRuntimeStatus(project.runtime_status),
      runtimeLastSeenAt: project.runtime_last_seen_at,
      kindLabel: getHostingKindLabel(project.hosting_kind),
      planName: plan?.name || project.hosting_plan_id,
      planPrice: `${formatMoney(plan?.monthlyAmount, plan?.currency)}${plan?.billingLabel || "/mes"}`,
      planSpecs: plan?.specs || ["VPS Windows", "Deploy via GitHub", "Logs em tempo real"],
      regionLabel: `${region.city}, ${region.country} - ${region.pingMs}ms`,
      runtime: project.windows_runtime || "windows-vps",
      repository: {
        fullName: repoName,
        name: repository.name,
        branch: repository.branch,
        language: repository.language,
        private: repository.private,
        description: repository.description,
        htmlUrl: repository.htmlUrl,
      },
      paymentLabel,
      paymentAmount,
      paidAtLabel: paymentOrder?.paid_at
        ? `Pago em ${formatDateTime(paymentOrder.paid_at)}`
        : `Criado em ${formatDateTime(paymentOrder?.created_at)}`,
    },
    metrics: [],
    logs: [],
    deployments: [],
    envVars: [],
    actions: [],
    fileTree,
  };

  const supabaseSnapshot = await Promise.all([
    supabase
      .from("hosting_vps_metrics")
      .select("*")
      .eq("hosting_project_id", project.id)
      .order("sampled_at", { ascending: false })
      .limit(48),
    supabase
      .from("hosting_vps_logs")
      .select("*")
      .eq("hosting_project_id", project.id)
      .order("emitted_at", { ascending: false })
      .limit(200),
    supabase
      .from("hosting_vps_deployments")
      .select("*")
      .eq("hosting_project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("hosting_vps_env_vars")
      .select("id, environment, key, value_preview, visible_value, note, sensitive, version, updated_at")
      .eq("hosting_project_id", project.id)
      .order("environment", { ascending: true })
      .order("key", { ascending: true }),
  ]);

  snapshot.metrics = (supabaseSnapshot[0].data || []).reverse();
  snapshot.logs = (supabaseSnapshot[1].data || []).reverse();
  snapshot.deployments = supabaseSnapshot[2].data || [];
  snapshot.envVars = supabaseSnapshot[3].data || [];

  return <VpsWorkspace initialSnapshot={snapshot} />;
}
