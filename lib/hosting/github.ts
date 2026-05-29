import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import {
  clearSharedAuthCookie,
  setSharedAuthCookie,
} from "@/lib/auth/cookies";
import {
  decryptFlowSecureValue,
  encryptFlowSecureValue,
} from "@/lib/security/flowSecure";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import type { HostingGitHubAccount, HostingRepository } from "@/lib/hosting/catalog";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_URL = "https://api.github.com";
const GITHUB_STATE_COOKIE = "flowdesk_hosting_github_state";
const GITHUB_TOKEN_COOKIE = "flowdesk_hosting_github_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const HANDOFF_TTL_MS = 2 * 60 * 1000;

type GitHubUser = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
  type?: string | null;
};

type GitHubOrg = {
  id: number;
  login: string;
  avatar_url?: string | null;
};

type GitHubRepo = {
  id: number;
  node_id?: string | null;
  name: string;
  full_name: string;
  description?: string | null;
  language?: string | null;
  private: boolean;
  html_url?: string | null;
  updated_at?: string | null;
  pushed_at?: string | null;
  default_branch?: string | null;
  owner: {
    login: string;
  };
};

type GitHubTreeItem = {
  path?: string;
  type?: "blob" | "tree" | string;
  size?: number;
};

type GitHubTreeResponse = {
  tree?: GitHubTreeItem[];
  truncated?: boolean;
};

type GitHubContentResponse = {
  type?: string;
  encoding?: string;
  content?: string;
  name?: string;
  path?: string;
};

export function isHostingGitHubConfigured() {
  return Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() &&
      process.env.GITHUB_CLIENT_SECRET?.trim(),
  );
}

export function resolveHostingGitHubRedirectUri(request: NextRequest) {
  const explicit =
    process.env.GITHUB_HOSTING_REDIRECT_URI?.trim() ||
    process.env.GITHUB_REDIRECT_URI?.trim();
  if (explicit) {
    const requestHostname = request.nextUrl.hostname.toLowerCase();

    if (
      requestHostname === "localhost" ||
      requestHostname === "127.0.0.1" ||
      requestHostname === "0.0.0.0"
    ) {
      return new URL("/api/auth/github/hosting/callback", request.nextUrl.origin).toString();
    }

    try {
      new URL(explicit);
    } catch {
      return new URL("/api/auth/github/hosting/callback", request.nextUrl.origin).toString();
    }

    return explicit;
  }
  return new URL("/api/auth/github/hosting/callback", request.nextUrl.origin).toString();
}

export function createHostingGitHubState() {
  const state = encryptFlowSecureValue(
    JSON.stringify({
      nonce: crypto.randomBytes(24).toString("base64url"),
      exp: Date.now() + 10 * 60 * 1000,
    }),
    {
      purpose: "auth_session_oauth",
      subcontext: "hosting_github_state",
    },
  );

  return state || crypto.randomBytes(24).toString("base64url");
}

export function validateHostingGitHubState(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;

  const decrypted = decryptFlowSecureValue(value, {
    purpose: "auth_session_oauth",
    subcontext: "hosting_github_state",
    allowPlaintextFallback: false,
  });

  if (!decrypted) return false;

  try {
    const parsed = JSON.parse(decrypted) as {
      nonce?: unknown;
      exp?: unknown;
    };
    return (
      typeof parsed.nonce === "string" &&
      parsed.nonce.length >= 16 &&
      typeof parsed.exp === "number" &&
      parsed.exp >= Date.now()
    );
  } catch {
    return false;
  }
}

export function setHostingGitHubStateCookie(
  request: NextRequest,
  response: NextResponse,
  state: string,
) {
  setSharedAuthCookie(request, response, GITHUB_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
    priority: "high",
  });
}

export async function readHostingGitHubStateCookie() {
  return (await cookies()).get(GITHUB_STATE_COOKIE)?.value || null;
}

export function clearHostingGitHubStateCookie(
  request: NextRequest,
  response: NextResponse,
) {
  clearSharedAuthCookie(request, response, GITHUB_STATE_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    priority: "high",
  });
}

export function setHostingGitHubTokenCookie(
  request: NextRequest,
  response: NextResponse,
  token: string,
) {
  const encrypted = encryptFlowSecureValue(token, {
    purpose: "auth_session_oauth",
    subcontext: "hosting_github",
  });
  if (!encrypted) return;

  setSharedAuthCookie(request, response, GITHUB_TOKEN_COOKIE, encrypted, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
    priority: "high",
  });
}

function encryptHostingGitHubTokenForUser(userId: number, token: string) {
  return encryptFlowSecureValue(token, {
    purpose: "hosting_github_token",
    subcontext: `user:${userId}`,
  });
}

function decryptHostingGitHubTokenForUser(userId: number, value: string | null | undefined) {
  return decryptFlowSecureValue(value, {
    purpose: "hosting_github_token",
    subcontext: `user:${userId}`,
    allowPlaintextFallback: false,
  });
}

export async function storeHostingGitHubTokenForUser(input: {
  userId: number;
  token: string;
  login?: string | null;
  accountType?: string | null;
  avatarUrl?: string | null;
}) {
  const encryptedToken = encryptHostingGitHubTokenForUser(input.userId, input.token);
  if (!encryptedToken) throw new Error("Nao foi possivel proteger o token do GitHub.");

  await getSupabaseAdminClientOrThrow()
    .from("hosting_github_connections")
    .upsert(
      {
        user_id: input.userId,
        github_login: input.login || null,
        github_account_type: input.accountType || null,
        github_avatar_url: input.avatarUrl || null,
        encrypted_token: encryptedToken,
        token_status: "active",
        last_validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
}

export async function readHostingGitHubStoredToken(userId: number) {
  try {
    const { data } = await getSupabaseAdminClientOrThrow()
      .from("hosting_github_connections")
      .select("encrypted_token, token_status")
      .eq("user_id", userId)
      .eq("token_status", "active")
      .maybeSingle<{ encrypted_token: string | null; token_status: string | null }>();

    if (!data?.encrypted_token) return null;
    return decryptHostingGitHubTokenForUser(userId, data.encrypted_token);
  } catch {
    return null;
  }
}

export async function markHostingGitHubTokenInvalid(userId: number, reason?: string | null) {
  await getSupabaseAdminClientOrThrow()
    .from("hosting_github_connections")
    .update({
      token_status: "invalid",
      last_error: reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

export async function readHostingGitHubToken(userId?: number | null) {
  const encrypted = (await cookies()).get(GITHUB_TOKEN_COOKIE)?.value || null;
  let cookieToken: string | null = null;
  if (encrypted) {
    try {
      cookieToken = decryptFlowSecureValue(encrypted, {
          purpose: "auth_session_oauth",
          subcontext: "hosting_github",
          allowPlaintextFallback: false,
        });
    } catch {
      cookieToken = null;
    }
  }
  if (cookieToken) return cookieToken;
  if (!userId) return null;
  return readHostingGitHubStoredToken(userId);
}

export async function hasHostingGitHubTokenCookie() {
  return Boolean((await cookies()).get(GITHUB_TOKEN_COOKIE)?.value);
}

export function createHostingGitHubHandoffToken(token: string) {
  return encryptFlowSecureValue(
    JSON.stringify({
      token,
      exp: Date.now() + HANDOFF_TTL_MS,
    }),
    {
      purpose: "auth_session_oauth",
      subcontext: "hosting_github_handoff",
    },
  );
}

export function consumeHostingGitHubHandoffToken(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  const decrypted = decryptFlowSecureValue(value, {
    purpose: "auth_session_oauth",
    subcontext: "hosting_github_handoff",
    allowPlaintextFallback: false,
  });

  if (!decrypted) return null;

  try {
    const parsed = JSON.parse(decrypted) as {
      token?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.token !== "string" || !parsed.token.trim()) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed.token;
  } catch {
    return null;
  }
}

export function buildHostingGitHubAuthorizeUrl(request: NextRequest, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID?.trim() || "",
    redirect_uri: resolveHostingGitHubRedirectUri(request),
    scope: "read:user repo read:org",
    state,
    allow_signup: "true",
  });

  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeHostingGitHubCode(input: {
  code: string;
  request: NextRequest;
}) {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID?.trim(),
      client_secret: process.env.GITHUB_CLIENT_SECRET?.trim(),
      code: input.code,
      redirect_uri: resolveHostingGitHubRedirectUri(input.request),
    }),
  });

  const payload = await response.json() as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Falha ao vincular o GitHub.");
  }

  return payload.access_token;
}

async function githubFetch<TValue>(path: string, token: string) {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`GitHub respondeu ${response.status}.`);
  }

  return await response.json() as TValue;
}

function mapUserToAccount(user: GitHubUser): HostingGitHubAccount {
  return {
    id: `user:${user.login}`,
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url || null,
    type: "user",
  };
}

function mapOrgToAccount(org: GitHubOrg): HostingGitHubAccount {
  return {
    id: `org:${org.login}`,
    login: org.login,
    name: org.login,
    avatarUrl: org.avatar_url || null,
    type: "organization",
  };
}

function formatUpdatedAt(value: string | null | undefined) {
  if (!value) return "Atualizado recentemente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Atualizado recentemente";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function mapRepo(repo: GitHubRepo): HostingRepository {
  return {
    id: String(repo.id),
    nodeId: repo.node_id || null,
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description || "Repositorio sem descricao.",
    language: repo.language || "Projeto",
    updatedAt: formatUpdatedAt(repo.pushed_at || repo.updated_at),
    branch: repo.default_branch || "main",
    private: repo.private,
    htmlUrl: repo.html_url || undefined,
  };
}

export async function fetchHostingGitHubProfile(token: string) {
  const [user, orgs] = await Promise.all([
    githubFetch<GitHubUser>("/user", token),
    githubFetch<GitHubOrg[]>("/user/orgs?per_page=100", token),
  ]);

  return {
    user: mapUserToAccount(user),
    accounts: [mapUserToAccount(user), ...orgs.map(mapOrgToAccount)],
  };
}

export async function fetchHostingGitHubRepositories(input: {
  token: string;
  owner?: string | null;
  ownerType?: string | null;
  query?: string | null;
}) {
  const owner = input.owner?.trim();
  const ownerType = input.ownerType?.trim().toLowerCase();
  const query = input.query?.trim().toLowerCase() || "";
  const path =
    owner && ownerType === "organization"
      ? `/orgs/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated&type=all`
      : owner && ownerType === "user"
        ? "/user/repos?per_page=100&sort=updated&type=all"
        : "/user/repos?per_page=100&sort=updated&type=all";
  const repos = await githubFetch<GitHubRepo[]>(path, input.token);
  const mapped = repos.map(mapRepo);

  if (!query) return mapped;

  return mapped.filter((repo) =>
    `${repo.owner}/${repo.name} ${repo.description} ${repo.language} ${repo.branch}`
      .toLowerCase()
      .includes(query),
  );
}

function languageFromPath(path: string) {
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
  };
  return languages[extension] || null;
}

export type HostingGitHubFileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  language?: string | null;
  children?: HostingGitHubFileNode[];
};

export async function fetchHostingGitHubRepositoryTree(input: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}) {
  const payload = await githubFetch<GitHubTreeResponse>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/trees/${encodeURIComponent(input.branch)}?recursive=1`,
    input.token,
  );
  const root: HostingGitHubFileNode = {
    name: input.repo,
    path: "/",
    type: "directory",
    children: [],
  };
  const directoryMap = new Map<string, HostingGitHubFileNode>([["", root]]);
  const sortedTree = [...(payload.tree || [])].sort((a, b) =>
    String(a.path || "").localeCompare(String(b.path || "")),
  );

  for (const item of sortedTree) {
    const itemPath = item.path?.replace(/^\/+/, "");
    if (!itemPath) continue;
    const parts = itemPath.split("/");
    const name = parts[parts.length - 1] || itemPath;
    const parentPath = parts.slice(0, -1).join("/");
    const parent = directoryMap.get(parentPath) || root;
    const isDirectory = item.type === "tree";
    const node: HostingGitHubFileNode = {
      name,
      path: itemPath,
      type: isDirectory ? "directory" : "file",
      language: isDirectory ? null : languageFromPath(itemPath),
      children: isDirectory ? [] : undefined,
    };
    parent.children = parent.children || [];
    parent.children.push(node);
    if (isDirectory) directoryMap.set(itemPath, node);
  }

  const sortChildren = (node: HostingGitHubFileNode) => {
    if (!node.children?.length) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortChildren);
  };
  sortChildren(root);
  return root.children || [];
}

export async function fetchHostingGitHubRepositoryFile(input: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
}) {
  const payload = await githubFetch<GitHubContentResponse>(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${input.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(input.branch)}`,
    input.token,
  );
  if (payload.type !== "file" || payload.encoding !== "base64" || !payload.content) {
    return null;
  }
  return {
    name: payload.name || input.path.split("/").pop() || input.path,
    path: payload.path || input.path,
    content: Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8"),
  };
}
