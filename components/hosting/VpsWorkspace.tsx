"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  Globe2,
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
  metadata?: Record<string, unknown> | null;
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
    githubConnected?: boolean;
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

const CONSOLE_STATUS_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "2xx", label: "2xx" },
  { value: "3xx", label: "3xx" },
  { value: "4xx", label: "4xx" },
  { value: "5xx", label: "5xx" },
  { value: "other", label: "Outros" },
] as const;

function languageFromFilePath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  const languages: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    css: "css",
    scss: "scss",
    html: "html",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    py: "python",
    sql: "sql",
    env: "dotenv",
    xml: "xml",
  };
  return languages[extension] || null;
}

function BracesIcon({ className = "" }: { className?: string }) {
  return <span className={`font-mono text-[13px] font-bold leading-none ${className}`}>{"{}"}</span>;
}

function FileTextIcon({ className = "" }: { className?: string }) {
  return <span className={`font-mono text-[12px] font-bold leading-none ${className}`}>MD</span>;
}

function fileIconStyle(node: VpsFileNode) {
  if (node.type === "directory") {
    return { Icon: Folder, className: "text-[#9BC2FF]" };
  }

  const language = (node.language || languageFromFilePath(node.path) || "").toLowerCase();
  const extension = node.path.split(".").pop()?.toLowerCase() || "";
  if (language === "typescript" || extension === "ts" || extension === "tsx") return { Icon: Code2, className: "text-[#62B3FF]" };
  if (language === "javascript" || extension === "js" || extension === "jsx") return { Icon: Code2, className: "text-[#F5D76E]" };
  if (language === "json") return { Icon: BracesIcon, className: "text-[#F2C66D]" };
  if (language === "css" || language === "scss") return { Icon: Globe2, className: "text-[#8AB6FF]" };
  if (language === "html" || language === "xml") return { Icon: Globe2, className: "text-[#FF9B73]" };
  if (language === "sql") return { Icon: Database, className: "text-[#B997FF]" };
  if (language === "dotenv" || extension === "env") return { Icon: KeyRound, className: "text-[#9BE7AC]" };
  if (language === "markdown" || extension === "md") return { Icon: FileTextIcon, className: "text-[#DADADA]" };
  if (language === "yaml" || extension === "yml" || extension === "yaml") return { Icon: Layers, className: "text-[#A8D1FF]" };
  return { Icon: File, className: "text-[#8E8E8E]" };
}

function resolveHighlightLanguage(file: VpsFileNode | null) {
  if (!file) return "text";
  return (file.language || languageFromFilePath(file.path) || "text").toLowerCase();
}

const CODE_KEYWORDS: Record<string, Set<string>> = {
  javascript: new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "switch", "case", "break", "continue", "import", "from", "export", "default", "async", "await", "try", "catch", "finally", "throw", "new", "class", "extends", "typeof", "instanceof", "true", "false", "null", "undefined"]),
  typescript: new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "switch", "case", "break", "continue", "import", "from", "export", "default", "async", "await", "try", "catch", "finally", "throw", "new", "class", "extends", "typeof", "instanceof", "true", "false", "null", "undefined", "type", "interface", "enum", "implements", "private", "public", "protected", "readonly", "as", "keyof"]),
  python: new Set(["def", "return", "if", "elif", "else", "for", "while", "in", "import", "from", "as", "class", "try", "except", "finally", "raise", "with", "lambda", "True", "False", "None", "async", "await"]),
  sql: new Set(["select", "from", "where", "join", "left", "right", "inner", "outer", "insert", "into", "update", "delete", "create", "alter", "drop", "table", "index", "view", "function", "trigger", "begin", "commit", "rollback", "values", "set", "and", "or", "not", "null", "primary", "key", "foreign", "references", "constraint", "check", "default"]),
};

function highlightGenericCode(line: string, language: string) {
  const keywords = CODE_KEYWORDS[language] || CODE_KEYWORDS.javascript;
  const parts = line.match(/(\/\/.*|--.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[{}()[\].,;:+*/%<>=!?&|-]|\s+|.)/g) || [line];
  return parts.map((part, index) => {
    let className = "text-[#DADADA]";
    if (/^(\/\/|--|#)/.test(part)) className = "text-[#6A9955]";
    else if (/^["'`]/.test(part)) className = "text-[#CE9178]";
    else if (/^\d/.test(part)) className = "text-[#B5CEA8]";
    else if (keywords.has(part) || keywords.has(part.toLowerCase())) className = "text-[#569CD6]";
    else if (/^[{}()[\]]+$/.test(part)) className = "text-[#FFD700]";
    return <span key={index} className={className}>{part}</span>;
  });
}

function highlightJson(line: string) {
  const parts = line.match(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|true|false|null|-?\b\d+(?:\.\d+)?\b|[{}[\],:]|\s+|.)/g) || [line];
  return parts.map((part, index) => {
    let className = "text-[#DADADA]";
    if (/^".*"\s*:$/.test(part)) className = "text-[#9CDCFE]";
    else if (/^"/.test(part)) className = "text-[#CE9178]";
    else if (/^(true|false|null)$/.test(part)) className = "text-[#569CD6]";
    else if (/^-?\d/.test(part)) className = "text-[#B5CEA8]";
    else if (/^[{}[\]]+$/.test(part)) className = "text-[#FFD700]";
    return <span key={index} className={className}>{part}</span>;
  });
}

function highlightMarkup(line: string) {
  const parts = line.match(/(<!--.*?-->|<\/?[A-Za-z][^>\s/]*|\/?>|[A-Za-z_:][-A-Za-z0-9_:.]*(?==)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\s+|.)/g) || [line];
  return parts.map((part, index) => {
    let className = "text-[#DADADA]";
    if (part.startsWith("<!--")) className = "text-[#6A9955]";
    else if (/^<\/?/.test(part) || part === ">" || part === "/>") className = "text-[#569CD6]";
    else if (/^[A-Za-z_:][-A-Za-z0-9_:.]*(?==)/.test(part)) className = "text-[#9CDCFE]";
    else if (/^["']/.test(part)) className = "text-[#CE9178]";
    return <span key={index} className={className}>{part}</span>;
  });
}

function highlightCss(line: string) {
  const parts = line.match(/(\/\*.*?\*\/|#[0-9a-fA-F]{3,8}\b|--[-A-Za-z0-9_]+|[-A-Za-z_][-\w]*(?=\s*:)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms)?\b|[{}():;,]|\s+|.)/g) || [line];
  return parts.map((part, index) => {
    let className = "text-[#DADADA]";
    if (part.startsWith("/*")) className = "text-[#6A9955]";
    else if (/^#[0-9a-fA-F]/.test(part)) className = "text-[#B5CEA8]";
    else if (/^--/.test(part) || /^[-A-Za-z_][-\w]*(?=\s*:)/.test(part)) className = "text-[#9CDCFE]";
    else if (/^["']/.test(part)) className = "text-[#CE9178]";
    else if (/^\d/.test(part)) className = "text-[#B5CEA8]";
    return <span key={index} className={className}>{part}</span>;
  });
}

function highlightEnv(line: string) {
  const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
  if (!match) return highlightGenericCode(line, "javascript");
  return [
    <span key="prefix" className="text-[#569CD6]">{match[1]}</span>,
    <span key="key" className="text-[#9CDCFE]">{match[2]}</span>,
    <span key="eq" className="text-[#D4D4D4]">{match[3]}</span>,
    <span key="value" className="text-[#CE9178]">{match[4]}</span>,
  ];
}

function renderHighlightedLine(line: string, language: string) {
  if (language === "json") return highlightJson(line);
  if (language === "html" || language === "xml") return highlightMarkup(line);
  if (language === "css" || language === "scss") return highlightCss(line);
  if (language === "dotenv") return highlightEnv(line);
  if (language === "markdown") return <span className={line.startsWith("#") ? "text-[#569CD6]" : "text-[#DADADA]"}>{line}</span>;
  return highlightGenericCode(line, language);
}

const TAB_ROUTE_SEGMENTS: Record<TabId, string> = {
  overview: "overview",
  metrics: "metrics",
  console: "console",
  files: "files",
  deploys: "deployments",
  env: "environment-variables",
};

const TAB_FROM_ROUTE_SEGMENT: Record<string, TabId> = {
  overview: "overview",
  metrics: "metrics",
  metricas: "metrics",
  console: "console",
  files: "files",
  arquivos: "files",
  deployments: "deploys",
  deploys: "deploys",
  "environment-variables": "env",
  env: "env",
  variables: "env",
};
const GITHUB_HANDOFF_STORAGE_KEY = "flowdesk_hosting_github_handoff_v1";

function resolveTabFromPathname(pathname: string | null): TabId {
  const segment = pathname?.split("/").filter(Boolean).at(-1)?.toLowerCase() || "";
  return TAB_FROM_ROUTE_SEGMENT[segment] || "overview";
}

function buildVpsTabPath(vpsCode: string, tabId: TabId) {
  return `/vps/${vpsCode}/${TAB_ROUTE_SEGMENTS[tabId]}`;
}

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

function metadataString(metadata: Record<string, unknown> | null | undefined, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function metadataNumber(metadata: Record<string, unknown> | null | undefined, keys: string[], fallback?: number) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^\d.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function resolveConsoleMethod(log: VpsLog) {
  const method = metadataString(log.metadata, ["method", "httpMethod", "request_method"]).toUpperCase();
  if (method) return method;
  const match = (log.message || "").match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i);
  return (match?.[1] || "LOG").toUpperCase();
}

function resolveConsolePath(log: VpsLog) {
  const path = metadataString(log.metadata, ["path", "route", "url", "requestPath", "request_path", "endpoint"]);
  if (path) return path;
  const match = (log.message || "").match(/(?:^|\s)(\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)/);
  if (match?.[1]) return match[1];
  return log.source ? `/${log.source.replace(/^\/+/, "")}` : "/runtime";
}

function resolveConsoleStatus(log: VpsLog) {
  const status = metadataNumber(log.metadata, ["status", "statusCode", "status_code", "code", "httpStatus"]);
  if (status) return Math.round(status);
  if (log.level === "error") return 500;
  if (log.level === "warn") return 429;
  if (log.level === "success") return 200;
  if (log.level === "debug") return 204;
  return 200;
}

function statusFamily(status: number) {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}

function statusClassName(status: number) {
  const family = statusFamily(status);
  if (family === "2xx") return "text-[#64D987]";
  if (family === "3xx") return "text-[#9BC2FF]";
  if (family === "4xx") return "text-[#FFD28A]";
  if (family === "5xx") return "text-[#FF8E8E]";
  return "text-[#A0A0A0]";
}

function formatConsoleClock(value?: string) {
  if (!value) return "--:--:--.--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--.--";
  const pad = (input: number, size = 2) => String(input).padStart(size, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(Math.floor(date.getMilliseconds() / 10))}`;
}

function buildConsoleEntry(log: VpsLog, index: number, fallbackHost: string) {
  const status = resolveConsoleStatus(log);
  const path = resolveConsolePath(log);
  const method = resolveConsoleMethod(log);
  const durationMs = metadataNumber(log.metadata, ["durationMs", "duration_ms", "duration", "elapsedMs", "elapsed_ms"]);
  const requestId = metadataString(log.metadata, ["requestId", "request_id", "traceId", "trace_id", "id"], log.id ? String(log.id) : logFingerprint(log, index));
  const host = metadataString(log.metadata, ["host", "hostname", "domain"], fallbackHost);
  const location = metadataString(log.metadata, ["location", "region", "edge", "datacenter"], "Sao Paulo, BR");
  const userAgent = metadataString(log.metadata, ["userAgent", "user_agent", "agent"], "runtime");
  const externalApis = metadataNumber(log.metadata, ["externalApis", "external_apis", "outgoingRequests", "outgoing_requests"], 0) || 0;

  return {
    key: `${logFingerprint(log, index)}-${index}`,
    log,
    status,
    family: statusFamily(status),
    method,
    path,
    host,
    requestId,
    location,
    userAgent,
    externalApis,
    durationMs,
    message: log.message || "Evento recebido sem mensagem.",
    level: log.level || "info",
    source: log.source || "runtime",
    time: log.emitted_at,
  };
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

function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`flowdesk-shimmer rounded-[12px] bg-[#151515] ${className}`} />;
}

function TabMainSkeleton({ tab }: { tab: TabId }) {
  if (tab === "metrics") {
    return (
      <section className="grid gap-[14px] lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <article key={index} className="rounded-[22px] border border-[#171717] bg-[#080808] p-[16px]">
            <div className="flex items-center justify-between">
              <div className="space-y-[10px]">
                <SkeletonBar className="h-[11px] w-[72px] rounded-full bg-[#111111]" />
                <SkeletonBar className="h-[28px] w-[104px]" />
              </div>
              <SkeletonBar className="h-[38px] w-[38px] rounded-[14px]" />
            </div>
            <SkeletonBar className="mt-[18px] h-[42px] w-full" />
            <SkeletonBar className="mt-[10px] h-[10px] w-[126px] rounded-full bg-[#111111]" />
          </article>
        ))}
      </section>
    );
  }

  if (tab === "files") {
    return (
      <section className="grid h-[calc(100vh-64px)] min-h-0 grid-cols-[300px_minmax(0,1fr)] bg-[#050505] max-md:grid-cols-1">
        <aside className="min-h-0 border-r border-[#171717] bg-[#080808] p-[10px]">
          <SkeletonBar className="h-[38px] w-full rounded-[10px]" />
          <div className="mt-[14px] space-y-[8px]">
            {Array.from({ length: 12 }, (_, index) => (
              <SkeletonBar key={index} className={`h-[26px] rounded-[9px] ${index % 3 === 0 ? "ml-0 w-[82%]" : "ml-[18px] w-[70%]"}`} />
            ))}
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-col bg-[#050505]">
          <div className="h-[48px] border-b border-[#171717] bg-[#080808] p-[12px]">
            <SkeletonBar className="h-[22px] w-[min(360px,60%)] rounded-full" />
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[48px_minmax(0,1fr)]">
            <div className="border-r border-[#111111] bg-[#070707] p-[12px]">
              <SkeletonBar className="h-full w-full rounded-[8px] bg-[#101010]" />
            </div>
            <div className="space-y-[10px] p-[12px]">
              {Array.from({ length: 16 }, (_, index) => (
                <SkeletonBar key={index} className={`h-[14px] rounded-full ${index % 4 === 0 ? "w-[42%]" : index % 2 === 0 ? "w-[76%]" : "w-[58%]"}`} />
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (tab === "deploys") {
    return (
      <section className="rounded-[24px] border border-[#171717] bg-[#080808] p-[16px]">
        <SkeletonBar className="h-[26px] w-[170px]" />
        <SkeletonBar className="mt-[10px] h-[12px] w-[min(420px,80%)] rounded-full bg-[#111111]" />
        <div className="mt-[18px] space-y-[10px]">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="rounded-[18px] border border-[#151515] bg-[#0B0B0B] p-[14px]">
              <div className="flex items-center justify-between gap-[14px]">
                <div className="min-w-0 flex-1 space-y-[10px]">
                  <SkeletonBar className="h-[24px] w-[184px] rounded-full" />
                  <SkeletonBar className="h-[14px] w-[70%] rounded-full" />
                  <SkeletonBar className="h-[11px] w-[48%] rounded-full bg-[#111111]" />
                </div>
                <SkeletonBar className="h-[34px] w-[96px] rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (tab === "env") {
    return (
      <section className="rounded-[24px] border border-[#171717] bg-[#080808] p-[16px]">
        <div className="flex items-center justify-between gap-[14px]">
          <div className="space-y-[10px]">
            <SkeletonBar className="h-[26px] w-[230px]" />
            <SkeletonBar className="h-[12px] w-[min(460px,70vw)] rounded-full bg-[#111111]" />
          </div>
          <SkeletonBar className="h-[42px] w-[150px] rounded-[12px]" />
        </div>
        <div className="mt-[16px] grid gap-[8px] xl:grid-cols-[minmax(220px,1fr)_250px_250px_230px]">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonBar key={index} className="h-[42px] rounded-[14px]" />
          ))}
        </div>
        <div className="mt-[18px] space-y-[8px]">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonBar key={index} className="h-[86px] rounded-[16px]" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-[14px]">
      <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBar key={index} className="h-[118px] rounded-[20px]" />
        ))}
      </div>
      <div className="grid gap-[14px] lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonBar key={index} className="h-[82px] rounded-[18px]" />
        ))}
      </div>
    </section>
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
  const router = useRouter();
  const pathname = usePathname();
  const notifications = useNotifications();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const routeTab = useMemo(() => resolveTabFromPathname(pathname), [pathname]);
  const [tab, setTab] = useState<TabId>(routeTab);
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [logsPaused, setLogsPaused] = useState(false);
  const [logQuery, setLogQuery] = useState("");
  const [logLevel, setLogLevel] = useState("all");
  const [consoleStatusFilter, setConsoleStatusFilter] = useState("all");
  const [selectedConsoleKey, setSelectedConsoleKey] = useState<string | null>(null);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<VpsFileNode | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [explorerWidth, setExplorerWidth] = useState(300);
  const [envSearch, setEnvSearch] = useState("");
  const [envFilter, setEnvFilter] = useState("all");
  const [envSort, setEnvSort] = useState("updated");
  const [envMenuId, setEnvMenuId] = useState<number | null>(null);
  const [visibleEnvValues, setVisibleEnvValues] = useState<Record<number, boolean>>({});
  const [envDrawerOpen, setEnvDrawerOpen] = useState(false);
  const [envDrawerMode, setEnvDrawerMode] = useState<"create" | "edit">("create");
  const [envSaving, setEnvSaving] = useState(false);
  const [githubReconnectOpen, setGithubReconnectOpen] = useState(!initialSnapshot.project.githubConnected);
  const [githubReconnectBusy, setGithubReconnectBusy] = useState(false);
  const [githubReconnectMessage, setGithubReconnectMessage] = useState(
    initialSnapshot.project.githubConnected
      ? ""
      : "Reconecte o GitHub para manter arquivos, deploys e variaveis sincronizados com seguranca.",
  );
  const [envEnvironment, setEnvEnvironment] = useState<EnvName>("production");
  const [envRows, setEnvRows] = useState<EnvDraftRow[]>([createDraftRow()]);
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);
  const highlightedCodeRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoSyncedFilesRef = useRef(false);
  const latestMetric = snapshot.metrics[snapshot.metrics.length - 1] || null;
  const shouldShowTabSkeleton = Boolean(pendingTab && pendingTab === tab);
  const centeredMainTabs = tab === "overview" || tab === "metrics" || tab === "deploys" || tab === "env";
  const lineCount = useMemo(
    () => Math.max(32, fileContent ? fileContent.split(/\r\n|\r|\n/).length : 1),
    [fileContent],
  );
  const highlightedLanguage = useMemo(() => resolveHighlightLanguage(selectedFile), [selectedFile]);
  const highlightedLines = useMemo(
    () => (fileContent ? fileContent.split(/\r\n|\r|\n/) : [""]),
    [fileContent],
  );

  const notify = useCallback((tone: NotifyTone, message: string, title = "VPS") => {
    if (tone === "success") notifications.success(message, { title });
    else if (tone === "error") notifications.error(message, { title });
    else notifications.show(message, { title, tone: "default" });
  }, [notifications]);

  const navigateToTab = useCallback((nextTab: TabId) => {
    if (nextTab === tab) return;
    setTab(nextTab);
    setPendingTab(nextTab);
    router.push(buildVpsTabPath(snapshot.project.vpsCode, nextTab), {
      scroll: false,
    });
  }, [router, snapshot.project.vpsCode, tab]);

  const startExplorerResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = explorerWidth;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(460, Math.max(220, startWidth + moveEvent.clientX - startX));
      setExplorerWidth(Math.round(nextWidth));
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, [explorerWidth]);

  useEffect(() => {
    setTab((current) => (current === routeTab ? current : routeTab));
    const timeoutId = window.setTimeout(() => {
      setPendingTab(null);
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [routeTab]);

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
        const text = `${log.source || ""} ${log.message || ""} ${JSON.stringify(log.metadata || {})}`.toLowerCase();
        return matchesLevel && (!logQuery || text.includes(logQuery.toLowerCase()));
      }),
    [logLevel, logQuery, snapshot.logs],
  );

  const consoleEntries = useMemo(
    () => filteredLogs.slice(-1000).map((log, index) => buildConsoleEntry(log, index, "fdesk.flwdesk.com")),
    [filteredLogs],
  );

  const visibleConsoleEntries = useMemo(
    () =>
      consoleEntries.filter((entry) =>
        consoleStatusFilter === "all" ? true : entry.family === consoleStatusFilter,
      ),
    [consoleEntries, consoleStatusFilter],
  );

  const consoleStats = useMemo(() => {
    const stats = { all: consoleEntries.length, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };
    consoleEntries.forEach((entry) => {
      stats[entry.family as keyof typeof stats] += 1;
    });
    return stats;
  }, [consoleEntries]);

  const selectedConsoleEntry = useMemo(
    () =>
      visibleConsoleEntries.find((entry) => entry.key === selectedConsoleKey) ||
      visibleConsoleEntries[visibleConsoleEntries.length - 1] ||
      null,
    [selectedConsoleKey, visibleConsoleEntries],
  );

  const selectedConsoleIndex = useMemo(
    () => visibleConsoleEntries.findIndex((entry) => entry.key === selectedConsoleEntry?.key),
    [selectedConsoleEntry?.key, visibleConsoleEntries],
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

  async function refreshConsoleLogs() {
    if (logsRefreshing) return;
    setLogsRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (logQuery.trim()) params.set("q", logQuery.trim());
      if (logLevel !== "all") params.set("level", logLevel);
      const response = await fetch(`/api/auth/me/hosting/vps/${snapshot.project.vpsCode}/logs?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = await response.json() as { ok?: boolean; logs?: VpsLog[]; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Nao consegui atualizar os logs.");
      setSnapshot((current) => ({ ...current, logs: payload.logs || [] }));
      notify("success", "Console atualizado.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Falha ao atualizar logs.");
    } finally {
      setLogsRefreshing(false);
    }
  }

  function exportConsoleLogs() {
    const payload = visibleConsoleEntries.map((entry) => ({
      time: entry.time,
      level: entry.level,
      status: entry.status,
      method: entry.method,
      host: entry.host,
      path: entry.path,
      message: entry.message,
      metadata: entry.log.metadata || {},
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${snapshot.project.vpsCode}-console-logs.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

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

  const syncFiles = useCallback(async (options?: { silent?: boolean }) => {
    if (filesBusy) return;
    setFilesBusy(true);
    try {
      const response = await fetch(`/api/auth/me/hosting/vps/${snapshot.project.vpsCode}/files?sync=1`);
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean;
        tree?: VpsFileNode[];
        message?: string;
        reconnectRequired?: boolean;
      };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Nao foi possivel sincronizar arquivos.");
      if (payload.reconnectRequired) {
        setGithubReconnectOpen(true);
        setGithubReconnectMessage(payload.message || "Reconecte o GitHub para espelhar arquivos.");
      }
      setSnapshot((current) => ({ ...current, fileTree: payload.tree || [] }));
      if (!options?.silent) {
        notify("success", "Arquivos sincronizados com o repositorio.");
      }
    } catch (error) {
      if (!options?.silent) {
        notify("error", error instanceof Error ? error.message : "Falha ao espelhar o GitHub.");
      }
    } finally {
      setFilesBusy(false);
    }
  }, [filesBusy, notify, snapshot.project.vpsCode]);

  const completeGithubReconnect = useCallback(async (handoffToken?: string | null) => {
    const response = await fetch("/api/auth/me/hosting/github/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoffToken }),
    });
    const payload = await response.json().catch(() => ({})) as {
      connected?: boolean;
      message?: string;
    };
    if (!response.ok || !payload.connected) {
      throw new Error(payload.message || "Nao foi possivel concluir o GitHub.");
    }
    setSnapshot((current) => ({
      ...current,
      project: { ...current.project, githubConnected: true },
    }));
    setGithubReconnectOpen(false);
    setGithubReconnectMessage("");
    notify("success", "GitHub reconectado com seguranca.");
    if (tab === "files") {
      void syncFiles({ silent: true });
    }
  }, [notify, syncFiles, tab]);

  const refreshGithubReconnectStatus = useCallback(async () => {
    const response = await fetch("/api/auth/me/hosting/github/status", {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as {
      connected?: boolean;
      message?: string;
    };
    if (!response.ok || !payload.connected) {
      throw new Error(payload.message || "GitHub ainda nao conectado.");
    }
    setSnapshot((current) => ({
      ...current,
      project: { ...current.project, githubConnected: true },
    }));
    setGithubReconnectOpen(false);
    setGithubReconnectMessage("");
    notify("success", "GitHub validado.");
    if (tab === "files") {
      void syncFiles({ silent: true });
    }
  }, [notify, syncFiles, tab]);

  const openGithubReconnectPopup = useCallback(() => {
    if (githubReconnectBusy) return;
    setGithubReconnectBusy(true);
    setGithubReconnectMessage("Abrindo GitHub em uma janela segura...");

    const popup = window.open(
      "/api/auth/github/hosting/start",
      "flowdesk-hosting-github",
      "width=980,height=760,menubar=no,toolbar=no,location=no,status=no",
    );

    if (!popup) {
      setGithubReconnectBusy(false);
      setGithubReconnectMessage("Permita popups para conectar o GitHub.");
      return;
    }

    let completed = false;
    const finish = () => {
      completed = true;
      setGithubReconnectBusy(false);
      window.removeEventListener("message", handleMessage);
      window.clearInterval(intervalId);
    };
    const finishWithStatus = async (handoffToken?: string | null) => {
      try {
        if (handoffToken) await completeGithubReconnect(handoffToken);
        else await refreshGithubReconnectStatus();
        finish();
      } catch (error) {
        setGithubReconnectMessage(error instanceof Error ? error.message : "Falha ao validar GitHub.");
        finish();
      }
    };
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; ok?: boolean; message?: string; handoffToken?: string };
      if (data?.source !== "flowdesk-hosting-github") return;
      if (!data.ok) {
        setGithubReconnectMessage(data.message || "GitHub recusou a autorizacao.");
        finish();
        return;
      }
      void finishWithStatus(data.handoffToken || null);
    };
    const intervalId = window.setInterval(() => {
      if (!popup.closed || completed) return;
      const raw = window.localStorage.getItem(GITHUB_HANDOFF_STORAGE_KEY);
      if (raw) {
        window.localStorage.removeItem(GITHUB_HANDOFF_STORAGE_KEY);
        try {
          const parsed = JSON.parse(raw) as { handoffToken?: string; storedAt?: number };
          if (!parsed.storedAt || Date.now() - parsed.storedAt < 120_000) {
            void finishWithStatus(parsed.handoffToken || null);
            return;
          }
        } catch {
          // fall through to status check
        }
      }
      void finishWithStatus(null);
    }, 500);

    window.addEventListener("message", handleMessage);
  }, [completeGithubReconnect, githubReconnectBusy, refreshGithubReconnectStatus]);

  useEffect(() => {
    if (tab === "files" && !snapshot.fileTree.length && !autoSyncedFilesRef.current) {
      autoSyncedFilesRef.current = true;
      void syncFiles({ silent: true });
    }
  }, [snapshot.fileTree.length, syncFiles, tab]);

  useEffect(() => {
    if (tab !== "files") return;

    const syncQuietly = () => {
      void syncFiles({ silent: true });
    };
    const intervalId = window.setInterval(syncQuietly, 20000);

    window.addEventListener("focus", syncQuietly);
    window.addEventListener("pageshow", syncQuietly);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncQuietly);
      window.removeEventListener("pageshow", syncQuietly);
    };
  }, [syncFiles, tab]);

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
    <main className="min-h-screen bg-[#050505] text-[#F1F1F1]">
      <div className="flex h-screen min-h-screen overflow-hidden">
        <aside className="sticky top-0 flex h-screen w-[280px] shrink-0 flex-col border-r border-[#171717] bg-[#080808] max-lg:hidden">
          <div className="border-b border-[#171717] p-[14px]">
            <div className="flex flex-col gap-[14px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-[8px]">
                <span className={`inline-flex items-center gap-[7px] rounded-full border px-[9px] py-[5px] text-[10px] font-bold uppercase tracking-[0.13em] ${statusClasses(snapshot.project.runtimeStatus)}`}>
                  <span className="h-[7px] w-[7px] rounded-full bg-current" />
                  {statusLabel(snapshot.project.runtimeStatus)}
                </span>
                <span className="inline-flex items-center gap-[7px] rounded-full border border-[#1D1D1D] bg-[#0D0D0D] px-[9px] py-[5px] text-[10px] font-bold uppercase tracking-[0.13em] text-[#8E8E8E]">
                  <Server className="h-[13px] w-[13px] text-[#0F62FE]" />
                  {snapshot.project.kindLabel}
                </span>
              </div>
              <h1 className="mt-[12px] break-words text-[19px] font-semibold leading-[1.12] tracking-[-0.035em] text-white">
                {snapshot.project.planName} - {snapshot.project.repository.name}
              </h1>
              <p className="mt-[7px] break-all font-mono text-[11px] leading-[1.45] text-[#777777]">
                {snapshot.project.vpsCode}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-[8px]">
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
                  className="inline-flex h-[36px] items-center justify-center gap-[6px] rounded-[10px] border border-[#1F1F1F] bg-[#101010] px-[9px] text-[11px] font-semibold text-[#DADADA] transition-colors hover:border-[#303030] hover:bg-[#151515] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {busyAction === action ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <Icon className="h-[14px] w-[14px]" />}
                  {String(label)}
                </button>
              ))}
            </div>
          </div>
          </div>

          <nav className="flex-1 space-y-[4px] overflow-y-auto p-[10px]">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToTab(item.id)}
                className={`flex h-[38px] w-full items-center gap-[10px] rounded-[10px] px-[11px] text-left text-[13px] font-semibold transition-colors ${
                  tab === item.id ? "bg-[#0F62FE] text-white" : "text-[#9B9B9B] hover:bg-[#111111] hover:text-white"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="border-t border-[#171717] p-[14px]">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#555555]">Repositorio</p>
            <p className="mt-[6px] truncate font-mono text-[12px] font-semibold text-[#DADADA]">{snapshot.project.repository.fullName}</p>
            <p className="mt-[4px] text-[12px] text-[#777777]">{snapshot.project.regionLabel}</p>
          </div>
        </aside>

        <section className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-[64px] items-center justify-between gap-[12px] border-b border-[#171717] bg-[#080808] px-[14px] lg:px-[22px]">
            <div className="min-w-0">
              <div className="flex items-center gap-[8px] lg:hidden">
                <Server className="h-[17px] w-[17px] text-[#0F62FE]" />
                <span className="truncate text-[13px] font-semibold text-white">{snapshot.project.repository.name}</span>
              </div>
              <p className="hidden truncate text-[14px] font-semibold text-white lg:block">
                {tabs.find((item) => item.id === tab)?.label || "VPS"} / {snapshot.project.repository.name}
              </p>
              <p className="mt-[3px] hidden truncate font-mono text-[11px] text-[#777777] lg:block">{snapshot.project.vpsCode}</p>
            </div>
            <div className="flex items-center gap-[8px]">
              <span className={`hidden items-center gap-[7px] rounded-full border px-[9px] py-[5px] text-[11px] font-bold uppercase tracking-[0.12em] sm:inline-flex ${statusClasses(snapshot.project.runtimeStatus)}`}>
                <span className="h-[6px] w-[6px] rounded-full bg-current" />
                {statusLabel(snapshot.project.runtimeStatus)}
              </span>
              <div className="flex gap-[6px] lg:hidden">
                {tabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateToTab(item.id)}
                    className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px] ${
                      tab === item.id ? "bg-[#0F62FE] text-white" : "bg-[#101010] text-[#9B9B9B]"
                    }`}
                    aria-label={item.label}
                  >
                    {item.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className={tab === "files" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto p-[18px] lg:p-[24px]"}>
            {shouldShowTabSkeleton ? (
              <div className={centeredMainTabs ? "mx-auto w-full max-w-[1180px]" : ""}>
                <TabMainSkeleton tab={tab} />
              </div>
            ) : (
              <div className={centeredMainTabs ? "mx-auto w-full max-w-[1180px]" : ""}>

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
          <section className="grid h-[calc(100vh-112px)] min-h-[560px] overflow-hidden rounded-[18px] border border-[#171717] bg-[#050505] xl:grid-cols-[minmax(0,1fr)_352px]">
            <div className="flex min-w-0 flex-col">
              <div className="flex flex-col gap-[10px] border-b border-[#171717] bg-[#070707] p-[10px] lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-[10px] rounded-[10px] border border-[#1B1B1B] bg-[#030303] px-[12px]">
                  <Search className="h-[15px] w-[15px] text-[#777777]" />
                  <input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Search logs..." className="h-[38px] min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#555555]" />
                </div>
                <div className="flex flex-wrap items-center gap-[8px]">
                  <CustomSelect value={logLevel} onChange={setLogLevel} options={[...LOG_OPTIONS]} className="w-[154px]" />
                  <button onClick={() => setLogsPaused((current) => !current)} className={`inline-flex h-[38px] items-center gap-[7px] rounded-[10px] border px-[12px] text-[12px] font-semibold transition-colors ${logsPaused ? "border-[#292929] bg-[#111111] text-[#DADADA]" : "border-[#1E3425] bg-[#07140B] text-[#9BE7AC]"}`}>
                    {logsPaused ? <Play className="h-[14px] w-[14px]" /> : <span className="h-[7px] w-[7px] rounded-full bg-[#34A853]" />}
                    {logsPaused ? "Retomar" : "Live"}
                  </button>
                  <button onClick={refreshConsoleLogs} disabled={logsRefreshing} className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-[#1B1B1B] bg-[#0B0B0B] text-[#DADADA] transition-colors hover:border-[#2A2A2A] disabled:cursor-not-allowed disabled:opacity-60" title="Atualizar logs">
                    <RefreshCw className={`h-[15px] w-[15px] ${logsRefreshing ? "animate-spin" : ""}`} />
                  </button>
                  <button onClick={exportConsoleLogs} className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-[#1B1B1B] bg-[#0B0B0B] text-[#DADADA] transition-colors hover:border-[#2A2A2A]" title="Exportar logs">
                    <Upload className="h-[15px] w-[15px]" />
                  </button>
                  <button onClick={() => setSnapshot((current) => ({ ...current, logs: [] }))} className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-[#1B1B1B] bg-[#0B0B0B] text-[#DADADA] transition-colors hover:border-[#2A2A2A]" title="Limpar console">
                    <Trash2 className="h-[15px] w-[15px]" />
                  </button>
                </div>
              </div>

              <div className="border-b border-[#151515] bg-[#050505] px-[10px] py-[8px]">
                <div className="flex flex-wrap items-center gap-[6px]">
                  {CONSOLE_STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setConsoleStatusFilter(option.value)}
                      className={`inline-flex h-[28px] items-center gap-[6px] rounded-[8px] border px-[9px] text-[11px] font-semibold transition-colors ${
                        consoleStatusFilter === option.value ? "border-[#2C2C2C] bg-[#171717] text-white" : "border-[#171717] bg-[#0A0A0A] text-[#8A8A8A] hover:text-white"
                      }`}
                    >
                      {option.label}
                      <span className="font-mono text-[10px] text-[#5E5E5E]">{consoleStats[option.value as keyof typeof consoleStats]}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-[10px] h-[36px] border-t border-[#101010]">
                  <div className="relative h-full">
                    {consoleEntries.length ? consoleEntries.slice(-80).map((entry, index, list) => {
                      const left = list.length <= 1 ? 0 : (index / (list.length - 1)) * 100;
                      const height = entry.family === "5xx" ? 26 : entry.family === "4xx" ? 20 : 14;
                      return (
                        <button
                          key={`timeline-${entry.key}`}
                          onClick={() => {
                            setSelectedConsoleKey(entry.key);
                            setConsoleStatusFilter(entry.family);
                          }}
                          className={`absolute bottom-[2px] w-[4px] rounded-t-[2px] ${entry.family === "5xx" ? "bg-[#FF8E8E]" : entry.family === "4xx" ? "bg-[#FFD28A]" : "bg-[#4A4A4A]"}`}
                          style={{ left: `${left}%`, height }}
                          title={`${entry.status} ${entry.path}`}
                        />
                      );
                    }) : null}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-[104px_1fr_1.4fr_minmax(220px,2fr)] gap-[12px] border-b border-[#171717] bg-[#070707] px-[12px] py-[9px] text-[11px] font-semibold text-[#6A6A6A]">
                <span>Status</span>
                <span>Host</span>
                <span>Request</span>
                <span>Messages</span>
              </div>
              <div ref={consoleRef} className="min-h-0 flex-1 overflow-auto bg-[#030303] font-mono text-[12px]">
                {visibleConsoleEntries.length ? visibleConsoleEntries.map((entry) => (
                  <button
                    key={entry.key}
                    onClick={() => setSelectedConsoleKey(entry.key)}
                    className={`grid w-full grid-cols-[104px_1fr_1.4fr_minmax(220px,2fr)] gap-[12px] border-b border-[#0D0D0D] px-[12px] py-[7px] text-left transition-colors hover:bg-[#141414] ${
                      selectedConsoleEntry?.key === entry.key ? "bg-[#191919]" : "odd:bg-[#060606] even:bg-[#0A0A0A]"
                    }`}
                  >
                    <span className="flex items-center gap-[7px] whitespace-nowrap">
                      <span className="text-[#7A7A7A]">{formatConsoleClock(entry.time)}</span>
                      <span className={statusClassName(entry.status)}>{entry.status}</span>
                    </span>
                    <span className="truncate font-semibold text-[#EFEFEF]">{entry.host}</span>
                    <span className="flex min-w-0 items-center gap-[7px]">
                      <span className="rounded-[4px] border border-[#2A2A2A] px-[4px] py-[1px] text-[10px] text-[#BDBDBD]">{entry.method}</span>
                      <span className="truncate text-[#F4F4F4]">{entry.path}</span>
                    </span>
                    <span className="truncate text-[#BDBDBD]">{entry.message}</span>
                  </button>
                )) : (
                  <div className="flex h-full items-center justify-center text-[#666666]">Nenhum log encontrado para os filtros atuais.</div>
                )}
              </div>
            </div>

            <aside className="min-h-0 overflow-auto border-t border-[#171717] bg-[#070707] xl:border-l xl:border-t-0">
              {selectedConsoleEntry ? (
                <div className="p-[14px]">
                  <div className="flex items-start justify-between gap-[10px]">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-[8px]">
                        <span className="rounded-[4px] border border-[#2A2A2A] px-[5px] py-[2px] font-mono text-[10px] text-white">{selectedConsoleEntry.method}</span>
                        <span className="truncate font-mono text-[13px] font-semibold text-white">{selectedConsoleEntry.path}</span>
                        <span className={`font-mono text-[12px] font-bold ${statusClassName(selectedConsoleEntry.status)}`}>{selectedConsoleEntry.status}</span>
                      </div>
                      <p className="mt-[8px] text-[11px] text-[#777777]">Request started</p>
                      <p className="mt-[2px] font-mono text-[11px] text-[#DADADA]">{formatDate(selectedConsoleEntry.time)}</p>
                    </div>
                    <div className="flex items-center gap-[6px]">
                      <button
                        onClick={() => {
                          const previous = visibleConsoleEntries[Math.max(0, selectedConsoleIndex - 1)];
                          if (previous) setSelectedConsoleKey(previous.key);
                        }}
                        disabled={selectedConsoleIndex <= 0}
                        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[#1B1B1B] text-[#AAAAAA] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                        title="Evento anterior"
                      >
                        <ChevronDown className="h-[14px] w-[14px] rotate-180" />
                      </button>
                      <button
                        onClick={() => {
                          const next = visibleConsoleEntries[Math.min(visibleConsoleEntries.length - 1, selectedConsoleIndex + 1)];
                          if (next) setSelectedConsoleKey(next.key);
                        }}
                        disabled={selectedConsoleIndex < 0 || selectedConsoleIndex >= visibleConsoleEntries.length - 1}
                        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[#1B1B1B] text-[#AAAAAA] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                        title="Proximo evento"
                      >
                        <ChevronDown className="h-[14px] w-[14px]" />
                      </button>
                      <button onClick={() => navigator.clipboard?.writeText(selectedConsoleEntry.requestId)} className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[#1B1B1B] text-[#AAAAAA] hover:text-white" title="Copiar request id">
                        <Copy className="h-[14px] w-[14px]" />
                      </button>
                      <button onClick={() => setSelectedConsoleKey(null)} className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[#1B1B1B] text-[#AAAAAA] hover:text-white" title="Fechar detalhe">
                        <X className="h-[14px] w-[14px]" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-[14px] rounded-[14px] border border-[#1A1A1A] bg-[#0B0B0B]">
                    {[
                      ["Request ID", selectedConsoleEntry.requestId],
                      ["Path", selectedConsoleEntry.path],
                      ["Host", selectedConsoleEntry.host],
                      ["Level", selectedConsoleEntry.level.toUpperCase()],
                      ["Source", selectedConsoleEntry.source],
                      ["User Agent", selectedConsoleEntry.userAgent],
                    ].map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[96px_minmax(0,1fr)] gap-[10px] border-b border-[#151515] px-[12px] py-[10px] last:border-b-0">
                        <span className="text-[11px] text-[#777777]">{label}</span>
                        <span className="break-words text-right font-mono text-[11px] text-[#DADADA]">{value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-[14px] space-y-[10px]">
                    <article className="rounded-[14px] border border-[#1A1A1A] bg-[#0B0B0B] p-[12px]">
                      <div className="flex items-center justify-between">
                        <p className="text-[13px] font-semibold text-white">Firewall</p>
                        <span className={selectedConsoleEntry.status >= 400 ? "text-[11px] font-semibold text-[#FFD28A]" : "text-[11px] font-semibold text-[#9BE7AC]"}>
                          {selectedConsoleEntry.status >= 400 ? "Inspecionado" : "Allowed"}
                        </span>
                      </div>
                      <p className="mt-[8px] text-[12px] text-[#777777]">Received in {selectedConsoleEntry.location}</p>
                    </article>
                    <article className="rounded-[14px] border border-[#1A1A1A] bg-[#0B0B0B] p-[12px]">
                      <div className="flex items-center justify-between">
                        <p className="text-[13px] font-semibold text-white">Middleware</p>
                        <span className={`font-mono text-[11px] ${statusClassName(selectedConsoleEntry.status)}`}>{selectedConsoleEntry.status}</span>
                      </div>
                      <div className="mt-[10px] grid gap-[8px] text-[12px]">
                        <div className="flex items-center justify-between text-[#888888]">
                          <span>Execution Duration</span>
                          <span className="font-mono text-[#DADADA]">{selectedConsoleEntry.durationMs ?? 0}ms</span>
                        </div>
                        <div className="flex items-center justify-between text-[#888888]">
                          <span>External APIs</span>
                          <span className="font-mono text-[#DADADA]">{selectedConsoleEntry.externalApis ? `${selectedConsoleEntry.externalApis} request(s)` : "No outgoing requests"}</span>
                        </div>
                      </div>
                    </article>
                    <article className="rounded-[14px] border border-[#1A1A1A] bg-[#0B0B0B] p-[12px]">
                      <p className="text-[13px] font-semibold text-white">Function Invocation</p>
                      <div className="mt-[10px] grid gap-[8px] text-[12px]">
                        <div className="flex items-center justify-between gap-[12px] text-[#888888]">
                          <span>Route</span>
                          <span className="truncate font-mono text-[#DADADA]">{selectedConsoleEntry.path}</span>
                        </div>
                        <div className="rounded-[10px] border border-[#171717] bg-[#050505] p-[10px] font-mono text-[11px] text-[#CFCFCF]">
                          {selectedConsoleEntry.message}
                        </div>
                      </div>
                    </article>
                  </div>

                  <p className={`mt-[14px] flex items-center gap-[7px] text-[12px] font-semibold ${selectedConsoleEntry.status >= 500 ? "text-[#FF8E8E]" : "text-[#9BE7AC]"}`}>
                    <span className="h-[7px] w-[7px] rounded-full bg-current" />
                    {selectedConsoleEntry.status >= 500 ? "Request failed" : `Response finished in ${selectedConsoleEntry.durationMs ?? 0}ms`}
                  </p>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center p-[24px] text-center text-[13px] text-[#777777]">
                  Selecione um evento do console para ver request, firewall, middleware e payload.
                </div>
              )}
            </aside>
          </section>
        ) : null}

        {tab === "files" ? (
          <section
            className="grid h-[calc(100vh-64px)] min-h-0 grid-cols-1 bg-[#050505] md:grid-cols-[var(--flowdesk-vps-explorer)_minmax(0,1fr)]"
            style={{ "--flowdesk-vps-explorer": `${explorerWidth}px` } as CSSProperties}
          >
            <aside className="relative min-h-0 border-r border-[#171717] bg-[#080808]">
              <div className="flex h-[48px] items-center justify-between gap-[10px] border-b border-[#171717] px-[12px]">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#8E8E8E]">Explorer</p>
                  <p className="mt-[2px] text-[10px] text-[#575757]">{explorerWidth}px</p>
                </div>
                <span className="inline-flex h-[26px] items-center gap-[6px] rounded-full border border-[#1F1F1F] bg-[#101010] px-[9px] text-[10px] font-bold uppercase tracking-[0.12em] text-[#777777]">
                  {filesBusy ? <Loader2 className="h-[12px] w-[12px] animate-spin text-[#9BC2FF]" /> : <span className="h-[6px] w-[6px] rounded-full bg-[#34A853]" />}
                  Live
                </span>
              </div>
              <div className="m-[10px] flex items-center gap-[8px] rounded-[10px] border border-[#171717] bg-[#0B0B0B] px-[10px]">
                <Search className="h-[15px] w-[15px] text-[#777777]" />
                <input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Buscar arquivo" className="h-[38px] min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none" />
              </div>
              <div className="h-[calc(100vh-160px)] overflow-auto px-[6px] pb-[12px]">
                {filteredTree.length ? filteredTree.map((node) => (
                  <FileTreeNode key={node.path} node={node} activePath={selectedFile?.path || ""} onSelect={loadFile} />
                )) : (
                  <div className="m-[8px] rounded-[12px] border border-[#151515] bg-[#0B0B0B] p-[14px] text-[13px] text-[#777777]">
                    {filesBusy ? "Espelhando arquivos do GitHub..." : "Aguardando arquivos do repositorio."}
                  </div>
                )}
              </div>
              <button
                type="button"
                onPointerDown={startExplorerResize}
                className="absolute right-[-4px] top-0 z-20 h-full w-[8px] cursor-col-resize border-x border-transparent transition-colors hover:border-[rgba(15,98,254,0.28)] hover:bg-[rgba(15,98,254,0.14)]"
                aria-label="Redimensionar Explorer"
                title="Redimensionar Explorer"
              />
            </aside>
            <div className="flex min-h-0 min-w-0 flex-col bg-[#050505]">
              <div className="flex h-[48px] items-center justify-between gap-[12px] border-b border-[#171717] bg-[#080808] px-[12px]">
                <div className="min-w-0">
                  <p className="min-w-0 truncate font-mono text-[13px] text-[#DADADA]">{selectedFile?.path || "Selecione um arquivo"}</p>
                  {selectedFile ? (
                    <p className="mt-[2px] text-[10px] font-bold uppercase tracking-[0.12em] text-[#555555]">
                      {highlightedLanguage}
                    </p>
                  ) : null}
                </div>
                <button disabled={!selectedFile || !fileDirty} onClick={saveFile} className="inline-flex h-[32px] items-center gap-[8px] rounded-[9px] bg-[#0F62FE] px-[11px] text-[12px] font-semibold text-white disabled:opacity-45">
                  <Save className="h-[15px] w-[15px]" /> Salvar
                </button>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-[48px_minmax(0,1fr)]">
                <div
                  ref={lineNumbersRef}
                  className="select-none overflow-hidden border-r border-[#111111] bg-[#070707] py-[12px] text-right font-mono text-[13px] leading-[22.1px] text-[#444444]"
                >
                  {Array.from({ length: lineCount }).map((_, index) => (
                    <div key={index} className="h-[22.1px] pr-[10px] leading-[22.1px]">{index + 1}</div>
                  ))}
                </div>
                <div className="relative min-h-0 min-w-0 bg-[#050505]">
                  <div
                    ref={highlightedCodeRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-hidden p-[12px] font-mono text-[13px] leading-[22.1px]"
                  >
                    <pre className="m-0 min-w-max whitespace-pre">
                      {highlightedLines.map((line, index) => (
                        <div key={index} className="h-[22.1px] leading-[22.1px]">
                          {line ? renderHighlightedLine(line, highlightedLanguage) : " "}
                        </div>
                      ))}
                    </pre>
                  </div>
                  <textarea
                    value={fileContent}
                    onChange={(event) => {
                      setFileContent(event.target.value);
                      setFileDirty(true);
                    }}
                    onScroll={(event) => {
                      if (lineNumbersRef.current) {
                        lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
                      }
                      if (highlightedCodeRef.current) {
                        highlightedCodeRef.current.scrollTop = event.currentTarget.scrollTop;
                        highlightedCodeRef.current.scrollLeft = event.currentTarget.scrollLeft;
                      }
                    }}
                    spellCheck={false}
                    wrap="off"
                    className="absolute inset-0 h-full min-h-0 w-full resize-none overflow-auto border-0 bg-transparent p-[12px] font-mono text-[13px] leading-[22.1px] text-transparent caret-[#E8E8E8] outline-none selection:bg-[rgba(15,98,254,0.35)] placeholder:text-[#5A5A5A]"
                    placeholder="O conteudo real aparece quando um arquivo sincronizado for selecionado."
                  />
                </div>
              </div>
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
            )}
          </div>
        </section>
      </div>

      {githubReconnectOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 px-[18px] backdrop-blur-[6px]">
          <div className="w-full max-w-[520px] overflow-hidden rounded-[24px] border border-[#202020] bg-[#080808] shadow-[0_26px_90px_rgba(0,0,0,0.54)]">
            <div className="border-b border-[#171717] px-[20px] py-[18px]">
              <div className="flex items-start justify-between gap-[14px]">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#777777]">GitHub</p>
                  <h2 className="mt-[8px] text-[22px] font-semibold tracking-[-0.04em] text-white">Reconectar repositorio</h2>
                </div>
                {snapshot.project.githubConnected ? (
                  <button
                    type="button"
                    onClick={() => setGithubReconnectOpen(false)}
                    className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] text-[#9B9B9B] hover:bg-[#111111] hover:text-white"
                    aria-label="Fechar"
                  >
                    <X className="h-[18px] w-[18px]" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="px-[20px] py-[18px]">
              <div className="rounded-[18px] border border-[#171717] bg-[#0B0B0B] p-[14px]">
                <p className="text-[14px] leading-[1.55] text-[#BDBDBD]">
                  A VPS precisa de uma conexao GitHub valida para espelhar arquivos, ler commits e aplicar deploys do repositorio
                  <span className="font-mono text-white"> {snapshot.project.repository.fullName}</span>.
                </p>
                <p className="mt-[10px] text-[12px] leading-[1.5] text-[#777777]">
                  O token fica criptografado por usuario no backend e nunca e exposto para o navegador.
                </p>
              </div>
              {githubReconnectMessage ? (
                <p className="mt-[12px] rounded-[14px] border border-[#171717] bg-[#060606] px-[12px] py-[10px] text-[12px] leading-[1.5] text-[#9B9B9B]">
                  {githubReconnectMessage}
                </p>
              ) : null}
              <div className="mt-[16px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-end">
                {snapshot.project.githubConnected ? (
                  <button
                    type="button"
                    onClick={() => setGithubReconnectOpen(false)}
                    className="inline-flex h-[42px] items-center justify-center rounded-[12px] border border-[#202020] bg-[#0D0D0D] px-[14px] text-[13px] font-semibold text-[#DADADA] hover:bg-[#121212]"
                  >
                    Agora nao
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={openGithubReconnectPopup}
                  disabled={githubReconnectBusy}
                  className="inline-flex h-[42px] items-center justify-center gap-[8px] rounded-[12px] bg-[#F2F2F2] px-[15px] text-[13px] font-semibold text-[#050505] hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {githubReconnectBusy ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <GitBranch className="h-[15px] w-[15px]" />}
                  Conectar GitHub
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
  const { Icon, className: iconClassName } = fileIconStyle(node);
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
            <Icon className={`h-[15px] w-[15px] ${iconClassName}`} />
          </>
        ) : (
          <>
            <span className="w-[13px]" />
            <Icon className={`h-[15px] w-[15px] ${iconClassName}`} />
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
