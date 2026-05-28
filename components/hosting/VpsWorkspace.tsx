"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  Database,
  Download,
  Eye,
  File,
  Folder,
  GitBranch,
  HardDrive,
  History,
  KeyRound,
  Layers,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Terminal,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { useNotifications } from "@/components/notifications/NotificationsProvider";

type RuntimeStatus = "online" | "offline" | "restarting" | "deploying" | "crashed" | "suspended" | "unknown";
type TabId = "overview" | "metrics" | "console" | "files" | "deploys" | "env";
type NotifyTone = "success" | "error" | "info";
type EnvName = "development" | "preview" | "production";

type VpsMetric = {
  id?: number;
  cpu_percent?: number;
  ram_percent?: number;
  disk_percent?: number;
  network_rx_kbps?: number;
  network_tx_kbps?: number;
  process_count?: number;
  uptime_seconds?: number;
  temperature_c?: number | null;
  app_cpu_percent?: number | null;
  app_ram_mb?: number | null;
  sampled_at?: string;
};

type VpsLog = {
  id?: number;
  level?: "debug" | "info" | "warn" | "error" | "success";
  source?: string;
  message?: string;
  emitted_at?: string;
};

type VpsDeployment = {
  id: number;
  environment: string;
  status: string;
  branch: string;
  commit_sha?: string | null;
  commit_author?: string | null;
  commit_message?: string | null;
  created_at?: string;
  deployed_at?: string | null;
  duration_ms?: number | null;
  logs?: unknown;
};

type VpsEnvVar = {
  id: number;
  environment: EnvName;
  key: string;
  value_preview?: string | null;
  visible_value?: string | null;
  note?: string | null;
  sensitive?: boolean | null;
  version?: number;
  updated_at?: string;
};

type EnvDraftRow = {
  id: string;
  key: string;
  value: string;
  note: string;
  sensitive: boolean;
  showValue: boolean;
};

type TextSecurityStyle = CSSProperties & {
  WebkitTextSecurity?: "none" | "disc";
};

type VpsFileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  language?: string | null;
  children?: VpsFileNode[];
};

export type VpsWorkspaceSnapshot = {
  project: {
    vpsCode: string;
    status: string;
    runtimeStatus: RuntimeStatus;
    runtimeLastSeenAt?: string | null;
    kindLabel: string;
    planName: string;
    planPrice: string;
    planSpecs: string[];
    regionLabel: string;
    runtime: string;
    repository: {
      fullName: string;
      name: string;
      branch: string;
      language?: string | null;
      private?: boolean | null;
      description?: string | null;
      htmlUrl: string;
    };
    paymentLabel: string;
    paymentAmount: string;
    paidAtLabel: string;
  };
  metrics: VpsMetric[];
  logs: VpsLog[];
  deployments: VpsDeployment[];
  envVars: VpsEnvVar[];
  actions: Array<Record<string, unknown>>;
  fileTree: VpsFileNode[];
};

type VpsWorkspaceProps = {
  initialSnapshot: VpsWorkspaceSnapshot;
};

const ENV_OPTIONS = [
  { value: "production", label: "Production" },
  { value: "preview", label: "Preview" },
  { value: "development", label: "Development" },
] as const;

const LOG_OPTIONS = [
  { value: "all", label: "Todos os logs" },
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
  { value: "success", label: "Success" },
] as const;

function formatDate(value?: string | null) {
  if (!value) return "Pendente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pendente";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(value?: string | null) {
  if (!value) return "Updated just now";
  const date = new Date(value);
  const diff = Math.max(0, Date.now() - date.getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `Updated ${Math.max(1, seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

function formatUptime(seconds?: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function statusClasses(status: RuntimeStatus) {
  if (status === "online") return "border-[rgba(52,168,83,0.35)] bg-[rgba(52,168,83,0.12)] text-[#9BE7AC]";
  if (status === "restarting" || status === "deploying") return "border-[rgba(15,98,254,0.35)] bg-[rgba(15,98,254,0.12)] text-[#9BC2FF]";
  if (status === "crashed") return "border-[rgba(255,82,82,0.35)] bg-[rgba(255,82,82,0.12)] text-[#FF9B9B]";
  if (status === "suspended") return "border-[rgba(255,190,80,0.35)] bg-[rgba(255,190,80,0.12)] text-[#FFD28A]";
  return "border-[#242424] bg-[#101010] text-[#9B9B9B]";
}

function statusLabel(status: RuntimeStatus) {
  const labels: Record<RuntimeStatus, string> = {
    online: "Online",
    offline: "Offline",
    restarting: "Reiniciando",
    deploying: "Deployando",
    crashed: "Crash/Error",
    suspended: "Suspensa",
    unknown: "Desconhecido",
  };
  return labels[status] || "Desconhecido";
}

function deploymentStatusClasses(status: string) {
  const normalized = status.toLowerCase();
  if (["ready", "production", "preview"].includes(normalized)) return "border-[rgba(52,168,83,0.32)] bg-[rgba(52,168,83,0.1)] text-[#9BE7AC]";
  if (["failed", "cancelled"].includes(normalized)) return "border-[rgba(255,82,82,0.32)] bg-[rgba(255,82,82,0.1)] text-[#FF9B9B]";
  if (["building", "preparing", "deploying", "queued", "pending"].includes(normalized)) return "border-[rgba(15,98,254,0.32)] bg-[rgba(15,98,254,0.1)] text-[#9BC2FF]";
  return "border-[#242424] bg-[#101010] text-[#DADADA]";
}

function metricValue(metric: VpsMetric | null, key: keyof VpsMetric) {
  const value = metric?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function createDraftRow(overrides: Partial<EnvDraftRow> = {}): EnvDraftRow {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    key: "",
    value: "",
    note: "",
    sensitive: true,
    showValue: false,
    ...overrides,
  };
}

function secureTextStyle(visible: boolean): TextSecurityStyle {
  return {
    WebkitTextSecurity: visible ? "none" : "disc",
  };
}

function parseDotEnv(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) return null;
      let value = match[2] || "";
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return createDraftRow({ key: match[1], value });
    })
    .filter((item): item is EnvDraftRow => Boolean(item));
}

function logFingerprint(log: VpsLog, fallbackIndex = 0) {
  if (log.id !== undefined && log.id !== null) return `id:${log.id}`;
  return [
    "log",
    log.emitted_at || "",
    log.level || "",
    log.source || "",
    log.message || "",
    fallbackIndex,
  ].join(":");
}

function mergeUniqueLogs(current: VpsLog[], incoming: VpsLog[]) {
  if (!incoming.length) return current;
  const seen = new Set(current.map((log, index) => logFingerprint(log, index)));
  const next = [...current];
  incoming.forEach((log, index) => {
    const fingerprint = logFingerprint(log, index);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    next.push(log);
  });
  return next.slice(-600);
}

function Sparkline({ values }: { values: number[] }) {
  const points = values.length ? values : [0];
  const max = Math.max(1, ...points);
  const d = points
    .map((value, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 32 - (Math.max(0, value) / max) * 28;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 36" className="h-[42px] w-full overflow-visible">
      <path d={d} fill="none" stroke="#0F62FE" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CustomSelect({
  value,
  options,
  onChange,
  className = "",
  icon,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) || options[0];

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        onBlur={() => window.setTimeout(() => setOpen(false), 130)}
        className="flex h-[42px] w-full items-center justify-between gap-[10px] rounded-[12px] border border-[#202020] bg-[#080808] px-[12px] text-left text-[13px] font-semibold text-[#E8E8E8] outline-none transition-colors hover:border-[#303030]"
      >
        <span className="flex min-w-0 items-center gap-[9px]">
          {icon ? <span className="text-[#8E8E8E]">{icon}</span> : null}
          <span className="truncate">{selected?.label || "Selecionar"}</span>
        </span>
        <ChevronDown className={`h-[15px] w-[15px] text-[#8E8E8E] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-[48px] z-30 overflow-hidden rounded-[14px] border border-[#242424] bg-[#090909] p-[5px] shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`flex h-[36px] w-full items-center justify-between rounded-[10px] px-[10px] text-left text-[13px] font-semibold transition-colors ${
                option.value === value ? "bg-[#171717] text-white" : "text-[#BDBDBD] hover:bg-[#111111] hover:text-white"
              }`}
            >
              {option.label}
              {option.value === value ? <Check className="h-[14px] w-[14px] text-[#0F62FE]" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function VpsWorkspace({ initialSnapshot }: VpsWorkspaceProps) {
  const notifications = useNotifications();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [tab, setTab] = useState<TabId>("overview");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [logsPaused, setLogsPaused] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [logLevel, setLogLevel] = useState("all");
  const [selectedFile, setSelectedFile] = useState<VpsFileNode | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [envSearch, setEnvSearch] = useState("");
  const [envFilter, setEnvFilter] = useState("all");
  const [envSort, setEnvSort] = useState("updated");
  const [envMenuId, setEnvMenuId] = useState<number | null>(null);
  const [visibleEnvValues, setVisibleEnvValues] = useState<Record<number, boolean>>({});
  const [envDrawerOpen, setEnvDrawerOpen] = useState(false);
  const [envDrawerMode, setEnvDrawerMode] = useState<"create" | "edit">("create");
  const [envSaving, setEnvSaving] = useState(false);
  const [envEnvironment, setEnvEnvironment] = useState<EnvName>("production");
  const [envRows, setEnvRows] = useState<EnvDraftRow[]>([createDraftRow()]);
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoSyncedFilesRef = useRef(false);
  const latestMetric = snapshot.metrics[snapshot.metrics.length - 1] || null;

  const notify = useCallback((tone: NotifyTone, message: string, title = "VPS") => {
    if (tone === "success") notifications.success(message, { title });
    else if (tone === "error") notifications.error(message, { title });
    else notifications.show(message, { title, tone: "default" });
  }, [notifications]);

  useEffect(() => {
    const events = new EventSource(`/api/auth/me/hosting/vps/${snapshot.project.vpsCode}/stream`);
    events.addEventListener("snapshot", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        project?: { runtime_status?: RuntimeStatus; runtime_last_seen_at?: string | null };
        metric?: VpsMetric | null;
        logs?: VpsLog[];
        actions?: Array<Record<string, unknown>>;
      };
      setSnapshot((current) => ({
        ...current,
        project: {
          ...current.project,
          runtimeStatus: payload.project?.runtime_status || current.project.runtimeStatus,
          runtimeLastSeenAt: payload.project?.runtime_last_seen_at || current.project.runtimeLastSeenAt,
        },
        metrics: payload.metric ? [...current.metrics.slice(-47), payload.metric] : current.metrics,
        logs: logsPaused ? current.logs : mergeUniqueLogs(current.logs, payload.logs || []),
        actions: payload.actions || current.actions,
      }));
    });
    events.addEventListener("error", () => {
      notify("error", "Conexao em tempo real instavel. Tentando reconectar.");
    });
    return () => events.close();
  }, [logsPaused, notify, snapshot.project.vpsCode]);

  useEffect(() => {
    if (!logsPaused) {
      consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [logsPaused, snapshot.logs.length, tab]);

  const filteredLogs = useMemo(
    () =>
      snapshot.logs.filter((log) => {
        const matchesLevel = logLevel === "all" || log.level === logLevel;
        const text = `${log.source || ""} ${log.message || ""}`.toLowerCase();
        return matchesLevel && (!logQuery || text.includes(logQuery.toLowerCase()));
      }),
    [logLevel, logQuery, snapshot.logs],
  );

  const filteredEnvVars = useMemo(() => {
    const query = envSearch.trim().toLowerCase();
    const list = snapshot.envVars.filter((item) => {
      const matchesEnv = envFilter === "all" || item.environment === envFilter;
      const matchesQuery = !query || `${item.key} ${item.environment} ${item.note || ""}`.toLowerCase().includes(query);
      return matchesEnv && matchesQuery;
    });
    return [...list].sort((a, b) => {
      if (envSort === "name") return a.key.localeCompare(b.key);
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    });
  }, [envFilter, envSearch, envSort, snapshot.envVars]);

  async function runAction(action: "start" | "stop" | "restart" | "sync") {
    if (busyAction) return;
    setBusyAction(action);
    setSnapshot((current) => ({
      ...current,
      project: {
        ...current.project,
        runtimeStatus: action === "restart" ? "restarting" : current.project.runtimeStatus,
      },
    }));
    try {
      const response = await fetch(`/api/auth/me/hosting/vps/${snapshot.project.vpsCode}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json() as { ok?: boolean; message?: string; status?: RuntimeStatus };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Falha na acao.");
      if (payload.status) {
        setSnapshot((current) => ({
          ...current,
          project: { ...current.project, runtimeStatus: payload.status || current.project.runtimeStatus },
        }));
      }
      notify("success", `Acao ${action} enviada para a VPS.`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Falha operacional.");
    } finally {
      setBusyAction(null);
    }
  }

  const syncFiles = useCallback(async () => {
    if (filesBusy) return;
    setFilesBusy(true);
    try {
      const response = await fetch(`/api/auth/me/hosting/vps/${snapshot.project.vpsCode}/files?sync=1`);
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; tree?: VpsFileNode[]; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Nao foi possivel sincronizar arquivos.");
      setSnapshot((current) => ({ ...current, fileTree: payload.tree || [] }));
      notify("success", "Arquivos sincronizados com o repositorio.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Falha ao espelhar o GitHub.");
    } finally {
      setFilesBusy(false);
    }
  }, [filesBusy, notify, snapshot.project.vpsCode]);

  useEffect(() => {
    if (tab === "files" && !snapshot.fileTree.length && !autoSyncedFilesRef.current) {
      autoSyncedFilesRef.current = true;
      void syncFiles();
    }
  }, [snapshot.fileTree.length, syncFiles, tab]);

  async function loadFile(node: VpsFileNode) {
    if (node.type !== "file") return;
    setSelectedFile(node);
    setFileDirty(false);
    const response = await fetch(`/api/auth/me/hosting/vps/${snapshot.project.vpsCode}/files?path=${encodeURIComponent(node.path)}`);
    const payload = await response.json().catch(() => ({})) as { file?: { content?: string } };
    setFileContent(payload.file?.content || "");
  }

  async function saveFile() {
    if (!selectedFile || !fileDirty) return;
    const response = await fetch(`/api/auth/me/hosting/vps/${snapshot.project.vpsCode}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selectedFile.path, content: fileContent }),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string };
    if (!response.ok || !payload.ok) {
      notify("error", payload.message || "Falha ao salvar arquivo.");
      return;
    }
    setFileDirty(false);
    notify("success", "Arquivo salvo com seguranca.");
  }

  function openCreateEnvDrawer() {
    setEnvDrawerMode("create");
    setEnvEnvironment("production");
    setEnvRows([createDraftRow()]);
    setEnvDrawerOpen(true);
  }

  function openEditEnvDrawer(item: VpsEnvVar) {
    setEnvMenuId(null);
    setEnvDrawerMode("edit");
    setEnvEnvironment(item.environment);
    setEnvRows([
      createDraftRow({
        key: item.key,
        value: item.sensitive ? "" : item.visible_value || item.value_preview || "",
        note: item.note || "",
        sensitive: item.sensitive !== false,
      }),
    ]);
    setEnvDrawerOpen(true);
  }

  async function saveEnvRows() {
    if (envSaving) return;
    const validRows = envRows
      .map((row) => ({ ...row, key: row.key.trim() }))
      .filter((row) => row.key && row.value);
    if (!validRows.length) {
      notify("error", "Informe chave e valor da variavel.", "Variaveis");
      return;
    }

    const duplicatedKey = validRows.find((row, index) =>
      validRows.findIndex((other) => other.key.toLowerCase() === row.key.toLowerCase()) !== index,
    );
    if (duplicatedKey) {
      notify("error", `Chave duplicada neste envio: ${duplicatedKey.key}.`, "Variaveis");
      return;
    }

    for (const row of validRows) {
      if (!/^[A-Z_][A-Z0-9_]{0,80}$/i.test(row.key)) {
        notify("error", `Chave invalida: ${row.key}.`, "Variaveis");
        return;
      }
    }

    setEnvSaving(true);
    try {
      const response = await fetch(`/api/auth/me/hosting/vps/${snapshot.project.vpsCode}/env`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environment: envEnvironment,
          variables: validRows.map((row) => ({
            key: row.key,
            value: row.value,
            note: row.note,
            sensitive: row.sensitive,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean;
        message?: string;
        envVar?: VpsEnvVar;
        envVars?: VpsEnvVar[];
      };
      const saved = payload.envVars?.length ? payload.envVars : payload.envVar ? [payload.envVar] : [];
      if (!response.ok || !payload.ok || !saved.length) {
        notify("error", payload.message || "Falha ao salvar variavel.", "Variaveis");
        return;
      }

      setSnapshot((current) => {
        const next = current.envVars.filter((item) =>
          !saved.some((savedItem) => savedItem.id === item.id || (savedItem.key === item.key && savedItem.environment === item.environment)),
        );
        return { ...current, envVars: [...saved, ...next] };
      });
      setEnvDrawerOpen(false);
      notify("success", saved.length > 1 ? "Variaveis salvas e aplicadas." : "Variavel salva e aplicada.", "Variaveis");
    } finally {
      setEnvSaving(false);
    }
  }

  async function deleteEnvVar(item: VpsEnvVar) {
    setEnvMenuId(null);
    const response = await fetch(`/api/auth/me/hosting/vps/${snapshot.project.vpsCode}/env`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, environment: item.environment, key: item.key }),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string };
    if (!response.ok || !payload.ok) {
      notify("error", payload.message || "Falha ao remover variavel.", "Variaveis");
      return;
    }
    setSnapshot((current) => ({ ...current, envVars: current.envVars.filter((env) => env.id !== item.id) }));
    notify("success", "Variavel removida.", "Variaveis");
  }

  async function copyEnvValue(item: VpsEnvVar) {
    const value = item.sensitive ? item.key : item.visible_value || item.value_preview || "";
    await navigator.clipboard.writeText(value);
    setEnvMenuId(null);
    notify("success", item.sensitive ? "Chave copiada. Valor sensivel permanece protegido." : "Valor copiado.", "Variaveis");
  }

  function importEnvFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseDotEnv(String(reader.result || ""));
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!rows.length) {
        notify("error", "Nao encontrei variaveis validas neste arquivo.", "Variaveis");
        return;
      }
      setEnvRows((current) => {
        const cleanCurrent = current.length === 1 && !current[0].key && !current[0].value ? [] : current;
        return [...cleanCurrent, ...rows];
      });
      notify("success", `${rows.length} variaveis importadas para revisao.`, "Variaveis");
    };
    reader.readAsText(file);
  }

  function updateEnvKey(rowId: string, value: string) {
    if (value.includes("=") && (value.includes("\n") || value.includes("\\n"))) {
      const rows = parseDotEnv(value.replace(/\\n/g, "\n"));
      if (rows.length) {
        setEnvRows((current) => current.flatMap((item) => item.id === rowId ? rows : [item]));
        notify("success", `${rows.length} variaveis importadas para revisao.`, "Variaveis");
        return;
      }
    }
    setEnvRows((current) => current.map((item) => item.id === rowId ? { ...item, key: value } : item));
  }

  const tabs: Array<{ id: TabId; label: string; icon: ReactNode }> = [
    { id: "overview", label: "Overview", icon: <Activity className="h-[15px] w-[15px]" /> },
    { id: "metrics", label: "Metricas", icon: <Cpu className="h-[15px] w-[15px]" /> },
    { id: "console", label: "Console", icon: <Terminal className="h-[15px] w-[15px]" /> },
    { id: "files", label: "Arquivos", icon: <Folder className="h-[15px] w-[15px]" /> },
    { id: "deploys", label: "Deploys", icon: <GitBranch className="h-[15px] w-[15px]" /> },
    { id: "env", label: "Env", icon: <KeyRound className="h-[15px] w-[15px]" /> },
  ];

  const filteredTree = useMemo(() => {
    if (!fileQuery.trim()) return snapshot.fileTree;
    const query = fileQuery.trim().toLowerCase();
    const filterNode = (node: VpsFileNode): VpsFileNode | null => {
      const children = (node.children || []).map(filterNode).filter((item): item is VpsFileNode => Boolean(item));
      if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query) || children.length) {
        return { ...node, children };
      }
      return null;
    };
    return snapshot.fileTree.map(filterNode).filter((item): item is VpsFileNode => Boolean(item));
  }, [fileQuery, snapshot.fileTree]);

  return (
    <main className="min-h-screen bg-[#050505] px-[18px] py-[22px] text-[#F1F1F1] sm:px-[28px] lg:px-[42px]">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-[18px]">
        <header className="rounded-[24px] border border-[#171717] bg-[#080808] p-[18px]">
          <div className="flex flex-col gap-[16px] xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-[10px]">
                <span className={`inline-flex items-center gap-[8px] rounded-full border px-[10px] py-[6px] text-[11px] font-bold uppercase tracking-[0.14em] ${statusClasses(snapshot.project.runtimeStatus)}`}>
                  <span className="h-[7px] w-[7px] rounded-full bg-current" />
                  {statusLabel(snapshot.project.runtimeStatus)}
                </span>
                <span className="inline-flex items-center gap-[8px] rounded-full border border-[#1D1D1D] bg-[#0D0D0D] px-[10px] py-[6px] text-[11px] font-bold uppercase tracking-[0.14em] text-[#8E8E8E]">
                  <Server className="h-[14px] w-[14px] text-[#0F62FE]" />
                  {snapshot.project.kindLabel}
                </span>
              </div>
              <h1 className="mt-[14px] break-words text-[30px] font-semibold tracking-[-0.04em] text-white">
                {snapshot.project.planName} - {snapshot.project.repository.name}
              </h1>
              <p className="mt-[8px] break-all font-mono text-[13px] text-[#8E8E8E]">
                {snapshot.project.vpsCode}
              </p>
            </div>
            <div className="flex flex-wrap gap-[10px]">
              {[
                ["start", "Iniciar", Play],
                ["restart", "Reiniciar", RotateCcw],
                ["stop", "Parar", Power],
                ["sync", "Status", RefreshCw],
              ].map(([action, label, Icon]) => (
                <button
                  key={String(action)}
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => void runAction(action as "start" | "stop" | "restart" | "sync")}
                  className="inline-flex h-[42px] items-center gap-[8px] rounded-[12px] border border-[#1F1F1F] bg-[#101010] px-[14px] text-[13px] font-semibold text-[#DADADA] transition-colors hover:border-[#303030] hover:bg-[#151515] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {busyAction === action ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <Icon className="h-[15px] w-[15px]" />}
                  {String(label)}
                </button>
              ))}
            </div>
          </div>

          <nav className="mt-[18px] flex gap-[8px] overflow-x-auto border-t border-[#151515] pt-[14px]">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex h-[38px] shrink-0 items-center gap-[8px] rounded-[12px] px-[12px] text-[13px] font-semibold transition-colors ${
                  tab === item.id ? "bg-[#0F62FE] text-white" : "bg-[#0D0D0D] text-[#9B9B9B] hover:text-white"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        {tab === "overview" ? (
          <section className="grid gap-[14px]">
            <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
              {[
                ["CPU", `${metricValue(latestMetric, "cpu_percent").toFixed(1)}%`, Cpu],
                ["RAM", `${metricValue(latestMetric, "ram_percent").toFixed(1)}%`, Database],
                ["Disco", `${metricValue(latestMetric, "disk_percent").toFixed(1)}%`, HardDrive],
                ["Uptime", formatUptime(metricValue(latestMetric, "uptime_seconds")), Wifi],
              ].map(([label, value, Icon]) => (
                <article key={String(label)} className="min-h-[118px] rounded-[20px] border border-[#171717] bg-[#080808] p-[16px]">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#606060]">{String(label)}</p>
                    <Icon className="h-[17px] w-[17px] text-[#0F62FE]" />
                  </div>
                  <p className="mt-[12px] text-[24px] font-semibold tracking-[-0.03em] text-white">{String(value)}</p>
                  <div className="mt-[12px] h-[5px] overflow-hidden rounded-full bg-[#111111]">
                    <div className="h-full rounded-full bg-[#0F62FE]" style={{ width: String(label) === "Uptime" ? "72%" : `${Math.min(100, metricValue(latestMetric, String(label) === "CPU" ? "cpu_percent" : String(label) === "RAM" ? "ram_percent" : "disk_percent"))}%` }} />
                  </div>
                </article>
              ))}
            </div>
            <div className="grid gap-[14px] lg:grid-cols-3">
              {[
                ["Repositorio", snapshot.project.repository.fullName],
                ["Branch", snapshot.project.repository.branch],
                ["Regiao", snapshot.project.regionLabel],
                ["Plano", `${snapshot.project.planName} - ${snapshot.project.planPrice}`],
                ["Pagamento", `${snapshot.project.paymentLabel} - ${snapshot.project.paymentAmount}`],
                ["Ultimo contato", formatDate(snapshot.project.runtimeLastSeenAt)],
              ].map(([label, value]) => (
                <article key={label} className="min-h-[82px] rounded-[18px] border border-[#171717] bg-[#080808] p-[14px]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#555555]">{label}</p>
                  <p className="mt-[7px] break-words text-[13px] font-semibold text-[#DADADA]">{value}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {tab === "metrics" ? (
          <section className="grid gap-[14px] lg:grid-cols-2">
            {[
              ["CPU", "cpu_percent", "%", Cpu],
              ["RAM", "ram_percent", "%", Database],
              ["Disco", "disk_percent", "%", HardDrive],
              ["Download", "network_rx_kbps", "kb/s", Download],
              ["Upload", "network_tx_kbps", "kb/s", Wifi],
              ["Processos", "process_count", "", Activity],
            ].map(([label, key, suffix, Icon]) => {
              const values = snapshot.metrics.map((item) => metricValue(item, key as keyof VpsMetric));
              const current = values[values.length - 1] || 0;
              const peak = Math.max(0, ...values);
              return (
                <article key={String(key)} className="rounded-[22px] border border-[#171717] bg-[#080808] p-[16px]">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#606060]">{String(label)}</p>
                      <p className="mt-[8px] text-[24px] font-semibold text-white">{current.toFixed(suffix === "" ? 0 : 1)}{String(suffix)}</p>
                    </div>
                    <Icon className="h-[20px] w-[20px] text-[#0F62FE]" />
                  </div>
                  <div className="mt-[14px]"><Sparkline values={values} /></div>
                  <p className="mt-[8px] text-[12px] text-[#777777]">Pico: {peak.toFixed(suffix === "" ? 0 : 1)}{String(suffix)}</p>
                </article>
              );
            })}
          </section>
        ) : null}

        {tab === "console" ? (
          <section className="rounded-[24px] border border-[#171717] bg-[#080808] p-[16px]">
            <div className="flex flex-col gap-[10px] md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-[10px] rounded-[14px] border border-[#171717] bg-[#0B0B0B] px-[12px]">
                <Search className="h-[16px] w-[16px] text-[#777777]" />
                <input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Buscar logs" className="h-[40px] min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none" />
              </div>
              <div className="flex flex-wrap gap-[8px]">
                <CustomSelect value={logLevel} onChange={setLogLevel} options={[...LOG_OPTIONS]} className="w-[170px]" />
                <button onClick={() => setLogsPaused((current) => !current)} className="inline-flex h-[42px] items-center gap-[8px] rounded-[12px] border border-[#171717] bg-[#0B0B0B] px-[12px] text-[13px] text-[#DADADA]">
                  {logsPaused ? <Play className="h-[15px] w-[15px]" /> : <Pause className="h-[15px] w-[15px]" />}
                  {logsPaused ? "Retomar" : "Pausar"}
                </button>
                <button onClick={() => setSnapshot((current) => ({ ...current, logs: [] }))} className="inline-flex h-[42px] items-center gap-[8px] rounded-[12px] border border-[#171717] bg-[#0B0B0B] px-[12px] text-[13px] text-[#DADADA]">
                  <Trash2 className="h-[15px] w-[15px]" /> Limpar
                </button>
              </div>
            </div>
            <div ref={consoleRef} className="mt-[14px] h-[540px] overflow-auto rounded-[18px] border border-[#151515] bg-[#030303] p-[12px] font-mono text-[12px]">
              {filteredLogs.length ? filteredLogs.slice(-1000).map((log, index) => (
                <div key={`${logFingerprint(log, index)}-${index}`} className="grid grid-cols-[138px_70px_minmax(0,1fr)] gap-[10px] border-b border-[#0D0D0D] py-[5px]">
                  <span className="text-[#555555]">{formatDate(log.emitted_at)}</span>
                  <span className={log.level === "error" ? "text-[#FF8E8E]" : log.level === "warn" ? "text-[#FFD28A]" : log.level === "success" ? "text-[#9BE7AC]" : "text-[#9BC2FF]"}>{(log.level || "info").toUpperCase()}</span>
                  <span className="break-words text-[#DADADA]">{log.message}</span>
                </div>
              )) : (
                <div className="flex h-full items-center justify-center text-[#666666]">Nenhum log recebido ainda.</div>
              )}
            </div>
          </section>
        ) : null}

        {tab === "files" ? (
          <section className="grid min-h-[620px] gap-[14px] xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="rounded-[22px] border border-[#171717] bg-[#080808] p-[14px]">
              <div className="flex items-center justify-between gap-[10px]">
                <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#606060]">Arquivos</p>
                <button type="button" onClick={syncFiles} disabled={filesBusy} className="inline-flex h-[34px] items-center gap-[7px] rounded-[10px] border border-[#1F1F1F] bg-[#101010] px-[10px] text-[12px] font-semibold text-[#DADADA] disabled:opacity-50">
                  {filesBusy ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <RefreshCw className="h-[14px] w-[14px]" />}
                  Sync
                </button>
              </div>
              <div className="mt-[12px] flex items-center gap-[8px] rounded-[12px] border border-[#171717] bg-[#0B0B0B] px-[10px]">
                <Search className="h-[15px] w-[15px] text-[#777777]" />
                <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Buscar arquivo" className="h-[38px] min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none" />
              </div>
              <div className="mt-[12px] max-h-[540px] overflow-auto pr-[4px]">
                {filteredTree.length ? filteredTree.map((node) => (
                  <FileTreeNode key={node.path} node={node} activePath={selectedFile?.path || ""} onSelect={loadFile} />
                )) : (
                  <div className="rounded-[16px] border border-[#151515] bg-[#0B0B0B] p-[14px] text-[13px] text-[#777777]">Sincronize para espelhar o repositorio do GitHub.</div>
                )}
              </div>
            </aside>
            <div className="rounded-[22px] border border-[#171717] bg-[#080808] p-[14px]">
              <div className="flex items-center justify-between gap-[12px]">
                <p className="min-w-0 truncate font-mono text-[13px] text-[#DADADA]">{selectedFile?.path || "Selecione um arquivo"}</p>
                <button disabled={!selectedFile || !fileDirty} onClick={saveFile} className="inline-flex h-[38px] items-center gap-[8px] rounded-[12px] bg-[#0F62FE] px-[12px] text-[13px] font-semibold text-white disabled:opacity-45">
                  <Save className="h-[15px] w-[15px]" /> Salvar
                </button>
              </div>
              <textarea
                value={fileContent}
                onChange={(event) => {
                  setFileContent(event.target.value);
                  setFileDirty(true);
                }}
                spellCheck={false}
                className="mt-[12px] h-[540px] w-full resize-none rounded-[16px] border border-[#151515] bg-[#030303] p-[14px] font-mono text-[13px] leading-[1.6] text-[#E8E8E8] outline-none"
                placeholder="O conteudo real aparece quando um arquivo sincronizado for selecionado."
              />
            </div>
          </section>
        ) : null}

        {tab === "deploys" ? (
          <section className="rounded-[24px] border border-[#171717] bg-[#080808] p-[16px]">
            <div className="flex flex-col gap-[8px] md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-[20px] font-semibold text-white">Deployments</h2>
                <p className="mt-[4px] text-[13px] text-[#777777]">Status espelhados dos commits, branches e ambientes do GitHub.</p>
              </div>
              <button onClick={() => void runAction("sync")} disabled={Boolean(busyAction)} className="inline-flex h-[40px] items-center gap-[8px] rounded-[12px] border border-[#1F1F1F] bg-[#101010] px-[12px] text-[13px] font-semibold text-[#DADADA]">
                {busyAction === "sync" ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <RefreshCw className="h-[15px] w-[15px]" />}
                Sincronizar
              </button>
            </div>
            <div className="mt-[16px] space-y-[10px]">
              {snapshot.deployments.length ? snapshot.deployments.map((deploy) => (
                <article key={deploy.id} className="rounded-[18px] border border-[#151515] bg-[#0B0B0B] p-[14px]">
                  <div className="flex flex-col gap-[10px] md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-[8px]">
                        <span className={`rounded-full border px-[10px] py-[5px] text-[12px] font-semibold ${deploymentStatusClasses(deploy.status)}`}>{deploy.status}</span>
                        <span className="rounded-full border border-[#242424] bg-[#101010] px-[10px] py-[5px] text-[12px] font-semibold text-[#DADADA]">{deploy.environment}</span>
                      </div>
                      <p className="mt-[10px] truncate text-[14px] font-semibold text-white">{deploy.commit_message || `Branch ${deploy.branch}`}</p>
                      <p className="mt-[4px] text-[12px] text-[#777777]">{deploy.commit_sha?.slice(0, 8) || "sem commit"} - {deploy.commit_author || "autor desconhecido"} - {formatDate(deploy.created_at)}</p>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="text-[12px] font-semibold text-[#DADADA]">{deploy.branch}</p>
                      <p className="mt-[4px] text-[12px] text-[#777777]">{deploy.duration_ms ? `${Math.round(deploy.duration_ms / 1000)}s` : "Aguardando build"}</p>
                    </div>
                  </div>
                </article>
              )) : (
                <div className="rounded-[18px] border border-[#151515] bg-[#0B0B0B] p-[18px] text-[13px] text-[#777777]">Nenhum commit/deploy sincronizado ainda.</div>
              )}
            </div>
          </section>
        ) : null}

        {tab === "env" ? (
          <section className="rounded-[24px] border border-[#171717] bg-[#080808] p-[16px]">
            <div className="flex flex-col gap-[12px] lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-[20px] font-semibold text-white">Environment Variables</h2>
                <p className="mt-[4px] text-[13px] text-[#777777]">Variaveis injetadas no runtime da VPS e nos proximos deploys.</p>
              </div>
              <button onClick={openCreateEnvDrawer} className="inline-flex h-[42px] items-center justify-center gap-[8px] rounded-[12px] bg-[#F2F2F2] px-[14px] text-[13px] font-semibold text-[#050505] transition-colors hover:bg-white">
                <Plus className="h-[15px] w-[15px]" /> Adicionar Variavel
              </button>
            </div>
            <div className="mt-[16px] grid gap-[8px] xl:grid-cols-[minmax(220px,1fr)_250px_250px_230px]">
              <div className="flex items-center gap-[10px] rounded-[14px] border border-[#202020] bg-[#080808] px-[12px]">
                <Search className="h-[16px] w-[16px] text-[#777777]" />
                <input value={envSearch} onChange={(event) => setEnvSearch(event.target.value)} placeholder="Search variables" className="h-[42px] min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none" />
              </div>
              <CustomSelect value={envFilter} onChange={setEnvFilter} options={[{ value: "all", label: "All Environments" }, ...ENV_OPTIONS]} icon={<Layers className="h-[15px] w-[15px]" />} />
              <CustomSelect value="all" onChange={() => undefined} options={[{ value: "all", label: "All Editors..." }]} icon={<Search className="h-[15px] w-[15px]" />} />
              <CustomSelect value={envSort} onChange={setEnvSort} options={[{ value: "updated", label: "Last Updated" }, { value: "name", label: "Name" }]} />
            </div>

            <div className="mt-[18px] space-y-[8px]">
              {filteredEnvVars.length ? filteredEnvVars.map((item) => {
                const canReveal = item.sensitive === false;
                const revealed = canReveal && visibleEnvValues[item.id];
                const displayValue = revealed ? item.visible_value || item.value_preview || "" : "************";
                return (
                  <article key={`${item.environment}-${item.key}-${item.id}`} className="relative rounded-[16px] border border-[#202020] bg-[#090909]">
                    <div className="grid min-h-[86px] items-center gap-[12px] px-[18px] py-[14px] lg:grid-cols-[minmax(220px,1fr)_minmax(180px,360px)_220px_82px]">
                      <div className="flex min-w-0 items-center gap-[14px]">
                        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-[#242424] bg-[#050505] text-[#9B9B9B]">
                          <Code2 className="h-[17px] w-[17px]" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[15px] font-semibold text-white">{item.key}</p>
                          <p className="mt-[3px] text-[13px] text-[#9B9B9B]">{item.environment === "production" ? "Production" : item.environment === "preview" ? "Preview" : "Development"}</p>
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center gap-[10px] font-mono text-[13px] text-[#DADADA]">
                        {canReveal ? (
                          <button type="button" onClick={() => setVisibleEnvValues((current) => ({ ...current, [item.id]: !current[item.id] }))} className="text-[#8E8E8E] hover:text-white">
                            <Eye className="h-[16px] w-[16px]" />
                          </button>
                        ) : null}
                        <span className="truncate">{displayValue}</span>
                      </div>
                      <div className="text-[13px] text-[#9B9B9B]">{formatRelative(item.updated_at)}</div>
                      <div className="flex justify-end">
                        <button type="button" onClick={() => setEnvMenuId((current) => current === item.id ? null : item.id)} className="flex h-[36px] w-[42px] items-center justify-center rounded-[10px] bg-[#151515] text-[#DADADA] hover:bg-[#1C1C1C]">
                          <MoreHorizontal className="h-[18px] w-[18px]" />
                        </button>
                      </div>
                    </div>
                    {envMenuId === item.id ? (
                      <div className="absolute right-[14px] top-[64px] z-30 w-[220px] overflow-hidden rounded-[16px] border border-[#242424] bg-[#0B0B0B] p-[6px] shadow-[0_18px_60px_rgba(0,0,0,0.48)]">
                        <button onClick={() => openEditEnvDrawer(item)} className="flex h-[40px] w-full items-center gap-[10px] rounded-[10px] px-[10px] text-left text-[13px] font-semibold text-[#E8E8E8] hover:bg-[#191919]"><Code2 className="h-[15px] w-[15px]" /> Edit</button>
                        <button onClick={() => void copyEnvValue(item)} className="flex h-[40px] w-full items-center gap-[10px] rounded-[10px] px-[10px] text-left text-[13px] font-semibold text-[#E8E8E8] hover:bg-[#191919]"><Copy className="h-[15px] w-[15px]" /> Copy to Clipboard</button>
                        <button onClick={() => { setEnvMenuId(null); notify("info", `Versao atual: v${item.version || 1}.`, "Historico"); }} className="flex h-[40px] w-full items-center gap-[10px] rounded-[10px] px-[10px] text-left text-[13px] font-semibold text-[#E8E8E8] hover:bg-[#191919]"><History className="h-[15px] w-[15px]" /> View History</button>
                        <button onClick={() => void deleteEnvVar(item)} className="flex h-[40px] w-full items-center gap-[10px] rounded-[10px] px-[10px] text-left text-[13px] font-semibold text-[#FF5252] hover:bg-[#191919]"><Trash2 className="h-[15px] w-[15px]" /> Delete</button>
                      </div>
                    ) : null}
                  </article>
                );
              }) : (
                <div className="rounded-[18px] border border-[#151515] bg-[#0B0B0B] p-[18px] text-[13px] text-[#777777]">Nenhuma variavel cadastrada.</div>
              )}
            </div>
          </section>
        ) : null}
      </div>

      {envDrawerOpen ? (
        <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]">
          <aside className="absolute bottom-[12px] right-[12px] top-[12px] flex w-[min(960px,calc(100vw-24px))] animate-[flowdeskSlideIn_220ms_ease-out] flex-col overflow-hidden rounded-[22px] border border-[#242424] bg-[#080808] shadow-[0_24px_90px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between border-b border-[#1D1D1D] px-[22px] py-[18px]">
              <h3 className="text-[20px] font-semibold tracking-[-0.03em] text-white">{envDrawerMode === "edit" ? "Edit Environment Variable" : "Add Environment Variable"}</h3>
              <button disabled={envSaving} onClick={() => setEnvDrawerOpen(false)} className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] text-[#DADADA] hover:bg-[#151515] disabled:cursor-not-allowed disabled:opacity-45"><X className="h-[18px] w-[18px]" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-[22px] py-[18px]">
              <div className="mb-[18px] rounded-[16px] border border-[#1D1D1D] bg-[#0B0B0B] p-[14px]">
                <div className="flex flex-wrap items-center gap-[8px]">
                  <span className="rounded-full border border-[#242424] bg-[#101010] px-[9px] py-[5px] text-[11px] font-bold uppercase tracking-[0.12em] text-[#9BC2FF]">
                    {envDrawerMode === "edit" ? "Editar" : "Novo"}
                  </span>
                  <span className="rounded-full border border-[#242424] bg-[#101010] px-[9px] py-[5px] text-[11px] font-bold uppercase tracking-[0.12em] text-[#BDBDBD]">
                    {envEnvironment}
                  </span>
                  <span className="rounded-full border border-[#242424] bg-[#101010] px-[9px] py-[5px] text-[11px] font-bold uppercase tracking-[0.12em] text-[#BDBDBD]">
                    {envRows.length} {envRows.length === 1 ? "variavel" : "variaveis"}
                  </span>
                </div>
                <p className="mt-[10px] text-[13px] leading-[1.5] text-[#8E8E8E]">
                  Variaveis sensiveis ficam protegidas permanentemente no painel. Desative Sensitive apenas para valores que podem ser vistos depois.
                </p>
              </div>
              <div className="space-y-[22px]">
                {envRows.map((row, index) => (
                  <div key={row.id} className={index > 0 ? "border-t border-[#1D1D1D] pt-[22px]" : ""}>
                    <div className="mb-[12px] flex items-center justify-between gap-[12px]">
                      <span className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#606060]">Variable {index + 1}</span>
                      {envRows.length > 1 ? (
                        <button type="button" disabled={envSaving} onClick={() => setEnvRows((current) => current.filter((item) => item.id !== row.id))} className="text-[#DADADA] hover:text-[#FF8E8E] disabled:cursor-not-allowed disabled:opacity-45"><Trash2 className="h-[17px] w-[17px]" /></button>
                      ) : null}
                    </div>
                    <label className="text-[13px] font-medium text-[#BDBDBD]">Key</label>
                    <input value={row.key} onChange={(event) => updateEnvKey(row.id, event.target.value)} className="mt-[8px] h-[52px] w-full rounded-[12px] border border-[#2A2A2A] bg-[#070707] px-[14px] font-mono text-[14px] text-white outline-none transition-colors focus:border-[#3A3A3A]" />
                    <label className="mt-[14px] block text-[13px] font-medium text-[#BDBDBD]">Value</label>
                    <div className="mt-[8px] flex h-[52px] items-center rounded-[12px] border border-[#2A2A2A] bg-[#070707] px-[14px] transition-colors focus-within:border-[#3A3A3A]">
                      <input
                        value={row.value}
                        type="text"
                        name={`flowdesk_env_${row.id}`}
                        autoComplete="new-password"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-lpignore="true"
                        data-1p-ignore="true"
                        style={secureTextStyle(row.showValue)}
                        onChange={(event) => setEnvRows((current) => current.map((item) => item.id === row.id ? { ...item, value: event.target.value } : item))}
                        className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-white outline-none"
                      />
                      {!row.sensitive ? (
                        <button type="button" onClick={() => setEnvRows((current) => current.map((item) => item.id === row.id ? { ...item, showValue: !item.showValue } : item))} className="text-[#8E8E8E] hover:text-white"><Eye className="h-[18px] w-[18px]" /></button>
                      ) : null}
                    </div>
                    <label className="mt-[14px] block text-[13px] font-medium text-[#BDBDBD]">Note (Optional)</label>
                    <input value={row.note} onChange={(event) => setEnvRows((current) => current.map((item) => item.id === row.id ? { ...item, note: event.target.value } : item))} placeholder="Where to rotate, or who to contact" className="mt-[8px] h-[52px] w-full rounded-[12px] border border-[#2A2A2A] bg-[#070707] px-[14px] text-[14px] text-white outline-none transition-colors focus:border-[#3A3A3A]" />
                    <div className="mt-[16px] flex items-start justify-between gap-[16px] rounded-[14px] border border-[#1D1D1D] bg-[#0B0B0B] p-[12px]">
                      <div>
                        <p className="text-[13px] font-semibold text-[#DADADA]">Sensitive</p>
                        <p className="mt-[3px] text-[12px] leading-[1.4] text-[#777777]">
                          {row.sensitive ? "Valor nao podera ser revelado depois de salvo." : "Valor podera ser visto e copiado no painel."}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={row.sensitive}
                        onClick={() => setEnvRows((current) => current.map((item) => item.id === row.id ? { ...item, sensitive: !item.sensitive, showValue: false } : item))}
                        className={`relative h-[30px] w-[52px] shrink-0 rounded-full border transition-colors ${
                          row.sensitive
                            ? "border-[rgba(15,98,254,0.45)] bg-[#0F62FE]"
                            : "border-[#303030] bg-[#202020]"
                        }`}
                      >
                        <span
                          className={`absolute left-[3px] top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.35)] transition-transform ${
                            row.sensitive ? "translate-x-[22px]" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {envDrawerMode === "create" ? (
                <button type="button" disabled={envSaving} onClick={() => setEnvRows((current) => [...current, createDraftRow()])} className="mt-[22px] inline-flex h-[42px] items-center gap-[9px] rounded-[12px] border border-[#2A2A2A] bg-[#0B0B0B] px-[13px] text-[13px] font-semibold text-[#E8E8E8] hover:bg-[#111111] disabled:cursor-not-allowed disabled:opacity-45">
                  <Plus className="h-[17px] w-[17px]" /> Add Another
                </button>
              ) : null}
              <div className="mt-[28px] border-t border-[#1D1D1D] pt-[22px]">
                <label className="mb-[8px] block text-[13px] font-medium text-[#BDBDBD]">Environments</label>
                <CustomSelect value={envEnvironment} onChange={(value) => setEnvEnvironment(value as EnvName)} options={[...ENV_OPTIONS]} icon={<Layers className="h-[15px] w-[15px]" />} />
              </div>
            </div>
            <div className="flex flex-col gap-[12px] border-t border-[#1D1D1D] px-[22px] py-[16px] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-[10px]">
                <input ref={fileInputRef} type="file" accept=".env,text/plain" className="hidden" onChange={(event) => importEnvFile(event.target.files?.[0] || null)} />
                {envDrawerMode === "create" ? (
                  <button type="button" disabled={envSaving} onClick={() => fileInputRef.current?.click()} className="inline-flex h-[42px] items-center gap-[9px] rounded-[12px] border border-[#2A2A2A] bg-[#0B0B0B] px-[13px] text-[13px] font-semibold text-[#E8E8E8] hover:bg-[#111111] disabled:cursor-not-allowed disabled:opacity-45">
                    <Upload className="h-[16px] w-[16px]" /> Import
                  </button>
                ) : null}
                <span className="text-[13px] text-[#9B9B9B]">or paste .env contents in Key input</span>
              </div>
              <div className="flex justify-end gap-[10px]">
                <button type="button" disabled={envSaving} onClick={() => setEnvDrawerOpen(false)} className="h-[42px] rounded-[12px] border border-[#2A2A2A] bg-[#0B0B0B] px-[16px] text-[13px] font-semibold text-[#E8E8E8] hover:bg-[#111111] disabled:cursor-not-allowed disabled:opacity-45">Cancel</button>
                <button type="button" disabled={envSaving} onClick={() => void saveEnvRows()} className="inline-flex h-[42px] min-w-[92px] items-center justify-center gap-[8px] rounded-[12px] bg-[#F2F2F2] px-[18px] text-[13px] font-semibold text-[#050505] hover:bg-white disabled:cursor-not-allowed disabled:opacity-70">
                  {envSaving ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : null}
                  {envSaving ? "Saving" : "Save"}
                </button>
              </div>
            </div>
          </aside>
          <style jsx global>{`
            @keyframes flowdeskSlideIn {
              from { transform: translateX(32px); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
          `}</style>
        </div>
      ) : null}
    </main>
  );
}

function FileTreeNode({
  node,
  activePath,
  onSelect,
  level = 0,
}: {
  node: VpsFileNode;
  activePath: string;
  onSelect: (node: VpsFileNode) => void;
  level?: number;
}) {
  const [open, setOpen] = useState(level < 1);
  const isDirectory = node.type === "directory";
  return (
    <div>
      <button
        type="button"
        onClick={() => isDirectory ? setOpen((current) => !current) : onSelect(node)}
        className={`flex h-[32px] w-full items-center gap-[8px] rounded-[10px] px-[8px] text-left text-[13px] transition-colors ${
          activePath === node.path ? "bg-[#0F62FE] text-white" : "text-[#BDBDBD] hover:bg-[#111111] hover:text-white"
        }`}
        style={{ paddingLeft: 8 + level * 12 }}
      >
        {isDirectory ? (
          <>
            <ChevronRight className={`h-[13px] w-[13px] transition-transform ${open ? "rotate-90" : ""}`} />
            <Folder className="h-[15px] w-[15px]" />
          </>
        ) : (
          <>
            <span className="w-[13px]" />
            <File className="h-[15px] w-[15px]" />
          </>
        )}
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {isDirectory && open ? (
        <div>
          {(node.children || []).map((child) => (
            <FileTreeNode key={child.path} node={child} activePath={activePath} onSelect={onSelect} level={level + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
