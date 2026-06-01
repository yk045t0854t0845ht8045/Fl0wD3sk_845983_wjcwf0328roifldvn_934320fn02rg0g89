import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuthSessionFromCookie } from "@/lib/auth/session";
import {
  appendVpsEvent,
  getHostingProjectForUser,
  isRecord,
  normalizeVpsCode,
  readString,
  requestVpsAgent,
} from "@/lib/hosting/vpsRuntime";
import {
  buildHostingGitHubAppInstallUrl,
  commitHostingGitHubRepositoryFile,
  fetchHostingGitHubRepositoryFile,
  fetchHostingGitHubRepositoryTree,
  HostingGitHubApiError,
  isPermanentHostingGitHubAuthError,
  readHostingGitHubInstallationTokenForRepository,
  readHostingGitHubStoredToken,
  readHostingGitHubToken,
} from "@/lib/hosting/github";
import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";
import { applyNoStoreHeaders } from "@/lib/security/http";

type RouteProps = {
  params: Promise<{ code: string }>;
};

async function load(code: string) {
  const session = await getCurrentAuthSessionFromCookie();
  const vpsCode = normalizeVpsCode(code);
  if (!session || !vpsCode) return null;
  const project = await getHostingProjectForUser({ userId: session.user.id, vpsCode });
  return project ? { session, project } : null;
}

function buildGitHubWritePermissionMessage(error?: unknown) {
  if (error instanceof HostingGitHubApiError) {
    if (error.ssoUrl) {
      return "Autorize o SSO da organizacao no GitHub e tente salvar novamente. A conta ja esta conectada, mas a organizacao exige liberacao extra para escrita.";
    }
    const detail = (error.githubMessage || error.message || "").toLowerCase();
    if (detail.includes("protected branch") || detail.includes("protected")) {
      return "A branch principal esta protegida. Criei uma branch Flowdesk quando possivel; se o GitHub bloquear tambem, use uma branch com permissao ou libere Pull Requests para esta conta.";
    }
  }
  const installUrl = buildHostingGitHubAppInstallUrl();
  if (installUrl) {
    return "O GitHub OAuth nao liberou escrita neste repositorio. Instale ou atualize o GitHub App Flowdesk nesta conta com permissao de Contents: Read and write e tente novamente.";
  }
  return "O GitHub conectado nao liberou escrita neste repositorio. Reconecte autorizando todos os escopos; se for organizacao, aprove o app/SSO ou use uma conta com permissao de push.";
}

function buildGitHubCommitPayload(input: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  vpsCode: string;
}) {
  return {
    token: input.token,
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    path: input.path,
    content: input.content,
    message: `Atualiza ${input.path} pelo painel Flowdesk`,
    allowFallbackBranch: true,
    fallbackBranch: `flowdesk/vps-${input.vpsCode.slice(0, 8)}`,
    pullRequestTitle: `Flowdesk: atualiza ${input.path}`,
    pullRequestBody: [
      "Alteracao criada automaticamente pelo painel Flowdesk.",
      "",
      `VPS: \`${input.vpsCode}\``,
      `Arquivo: \`${input.path}\``,
      `Branch base: \`${input.branch}\``,
    ].join("\n"),
  };
}

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  language?: string | null;
  children?: FileTreeNode[];
};

function languageFromFilePath(path: string) {
  const baseName = path.split("/").pop()?.toLowerCase() || "";
  const extension = baseName.includes(".") ? baseName.split(".").pop()?.toLowerCase() || "" : baseName;
  const exactLanguages: Record<string, string> = {
    dockerfile: "docker",
    makefile: "makefile",
    "package.json": "node",
    "package-lock.json": "node",
    "pnpm-lock.yaml": "node",
    "yarn.lock": "node",
    "bun.lockb": "node",
    "tsconfig.json": "typescript",
    "jsconfig.json": "javascript",
    "next.config.js": "javascript",
    "next.config.mjs": "javascript",
    "next.config.ts": "typescript",
    "vite.config.js": "javascript",
    "vite.config.ts": "typescript",
    "tailwind.config.js": "javascript",
    "tailwind.config.ts": "typescript",
  };
  if (exactLanguages[baseName]) return exactLanguages[baseName];

  const languages: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    ts: "typescript",
    mts: "typescript",
    cts: "typescript",
    tsx: "typescript",
    json: "json",
    jsonc: "json",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "css",
    html: "html",
    htm: "html",
    md: "markdown",
    mdx: "markdown",
    yml: "yaml",
    yaml: "yaml",
    py: "python",
    pyw: "python",
    rb: "ruby",
    php: "php",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    swift: "swift",
    go: "go",
    rs: "rust",
    c: "c",
    h: "c",
    cc: "cpp",
    cpp: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    dart: "dart",
    lua: "lua",
    r: "r",
    scala: "scala",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    ps1: "powershell",
    bat: "batch",
    cmd: "batch",
    cbl: "cobol",
    cob: "cobol",
    cpy: "cobol",
    sql: "sql",
    prisma: "prisma",
    graphql: "graphql",
    gql: "graphql",
    env: "dotenv",
    xml: "xml",
    svg: "svg",
    toml: "toml",
    ini: "ini",
    lock: "lockfile",
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    webp: "image",
    ico: "image",
    avif: "image",
    woff: "font",
    woff2: "font",
    ttf: "font",
    otf: "font",
    zip: "archive",
    rar: "archive",
    "7z": "archive",
    gz: "archive",
  };
  return languages[extension] || null;
}

function normalizeFilePath(value: unknown) {
  return (readString(value) || "").replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
}

function fileNameFromPath(path: string) {
  return path.split("/").filter(Boolean).pop() || path;
}

function parentFilePath(path: string) {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function sortTree(nodes: FileTreeNode[]) {
  return [...nodes].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children?.length) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function addNode(nodes: FileTreeNode[], parentPath: string, node: FileTreeNode): FileTreeNode[] {
  if (!parentPath) {
    if (nodes.some((item) => item.path === node.path)) return nodes;
    return sortTree([...nodes, node]);
  }
  return nodes.map((item) => {
    if (item.path === parentPath && item.type === "directory") {
      const children = item.children || [];
      if (children.some((child) => child.path === node.path)) return item;
      return { ...item, children: sortTree([...children, node]) };
    }
    if (item.children?.length) return { ...item, children: addNode(item.children, parentPath, node) };
    return item;
  });
}

function removeNode(nodes: FileTreeNode[], path: string): FileTreeNode[] {
  return nodes
    .filter((node) => node.path !== path)
    .map((node) => node.children?.length ? { ...node, children: removeNode(node.children, path) } : node);
}

function rebaseNode(node: FileTreeNode, targetPath: string): FileTreeNode {
  const oldPath = node.path;
  const walk = (item: FileTreeNode): FileTreeNode => {
    const nextPath = item.path === oldPath ? targetPath : item.path.replace(`${oldPath}/`, `${targetPath}/`);
    return {
      ...item,
      name: item.path === oldPath ? fileNameFromPath(targetPath) : item.name,
      path: nextPath,
      language: item.type === "file" ? languageFromFilePath(nextPath) : item.language,
      children: item.children?.map(walk),
    };
  };
  return walk(node);
}

function upsertRuntimeFileTree(tree: FileTreeNode[], action: string, path: string, targetPath?: string, type?: string) {
  if (action === "create-file" || action === "create-folder") {
    const node: FileTreeNode = {
      name: fileNameFromPath(path),
      path,
      type: action === "create-folder" ? "directory" : "file",
      language: action === "create-file" ? languageFromFilePath(path) : null,
      children: action === "create-folder" ? [] : undefined,
    };
    return addNode(tree, parentFilePath(path), node);
  }
  if (action === "delete") return removeNode(tree, path);
  if ((action === "rename" || action === "move") && targetPath) {
    const node = findNode(tree, path);
    if (!node || targetPath.startsWith(`${path}/`)) return tree;
    return addNode(removeNode(tree, path), parentFilePath(targetPath), rebaseNode({ ...node, type: type === "directory" ? "directory" : node.type }, targetPath));
  }
  return tree;
}

async function updateRuntimeFilesPayload(input: {
  projectId: number;
  currentPayload: Record<string, unknown>;
  tree: FileTreeNode[];
  fileContents?: Record<string, string>;
}) {
  await getSupabaseAdminClientOrThrow()
    .from("hosting_projects")
    .update({
      runtime_status_payload: {
        ...input.currentPayload,
        fileTree: input.tree,
        fileTreeSource: "panel",
        fileTreeSyncedAt: new Date().toISOString(),
        ...(input.fileContents ? { fileContents: input.fileContents } : {}),
      },
    })
    .eq("id", input.projectId);
}

export async function GET(request: NextRequest, { params }: RouteProps) {
  const { code } = await params;
  const loaded = await load(code);
  if (!loaded) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "VPS nao encontrada." }, { status: 404 }),
    );
  }
  const path = request.nextUrl.searchParams.get("path") || "";
  const sync = request.nextUrl.searchParams.get("sync") === "1";
  try {
    const payload = await requestVpsAgent({
      project: loaded.project,
      path: `/v1/vps/${loaded.project.vps_code}/files?path=${encodeURIComponent(path)}${sync ? "&recursive=1" : ""}`,
      timeoutMs: 12_000,
    });
    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        ...(isRecord(payload) ? payload : { payload }),
      }),
    );
  } catch {
    const runtimePayload = isRecord(loaded.project.runtime_status_payload)
      ? loaded.project.runtime_status_payload
      : {};
    const fileContents = isRecord(runtimePayload.fileContents) ? runtimePayload.fileContents : {};
    if (path && typeof fileContents[path] === "string") {
      return applyNoStoreHeaders(
        NextResponse.json({
          ok: true,
          file: {
            path,
            name: fileNameFromPath(path),
            content: fileContents[path],
          },
          agentConnected: false,
          source: "panel",
        }),
      );
    }
    const token = await readHostingGitHubToken(loaded.project.user_id);
    let githubFailed = false;
    if (token && path) {
      const file = await fetchHostingGitHubRepositoryFile({
        token,
        owner: loaded.project.github_owner,
        repo: loaded.project.github_repo,
        branch: loaded.project.github_branch,
        path,
      }).catch((error) => {
        githubFailed = isPermanentHostingGitHubAuthError(error);
        return null;
      });
      if (file) {
        return applyNoStoreHeaders(
          NextResponse.json({ ok: true, file, agentConnected: false, source: "github" }),
        );
      }
    }

    if (token && (sync || !path)) {
      const tree = await fetchHostingGitHubRepositoryTree({
        token,
        owner: loaded.project.github_owner,
        repo: loaded.project.github_repo,
        branch: loaded.project.github_branch,
      }).catch((error) => {
        githubFailed = isPermanentHostingGitHubAuthError(error);
        return null;
      });
      if (tree) {
        const currentPayload = isRecord(loaded.project.runtime_status_payload)
          ? loaded.project.runtime_status_payload
          : {};
        await getSupabaseAdminClientOrThrow()
          .from("hosting_projects")
          .update({
            runtime_status_payload: {
              ...currentPayload,
              fileTree: tree,
              fileTreeSource: "github",
              fileTreeSyncedAt: new Date().toISOString(),
            },
          })
          .eq("id", loaded.project.id);
        return applyNoStoreHeaders(
          NextResponse.json({ ok: true, tree, file: null, agentConnected: false, source: "github" }),
        );
      }
    }

    return applyNoStoreHeaders(
      NextResponse.json({
        ok: true,
        tree: Array.isArray(runtimePayload.fileTree) ? runtimePayload.fileTree : [],
        file: null,
        agentConnected: false,
        reconnectRequired: !token || githubFailed,
        message: !token
          ? "Reconecte o GitHub para espelhar os arquivos."
          : githubFailed
            ? "Nao consegui validar o GitHub deste repositorio. Reconecte a conta."
            : undefined,
      }),
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const { code } = await params;
  const loaded = await load(code);
  if (!loaded) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "VPS nao encontrada." }, { status: 404 }),
    );
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = readString(body.action) || "";
  const path = normalizeFilePath(body.path);
  const targetPath = normalizeFilePath(body.targetPath);
  const nodeType = readString(body.type) === "directory" ? "directory" : "file";
  const currentPayload = isRecord(loaded.project.runtime_status_payload)
    ? loaded.project.runtime_status_payload
    : {};
  const currentTree = Array.isArray(currentPayload.fileTree)
    ? currentPayload.fileTree as FileTreeNode[]
    : [];

  if (["create-file", "create-folder", "rename", "delete", "move"].includes(action)) {
    if (!path || ((action === "rename" || action === "move") && !targetPath)) {
      return applyNoStoreHeaders(
        NextResponse.json({ ok: false, message: "Operacao de arquivo invalida." }, { status: 400 }),
      );
    }

    let agentOk = false;
    try {
      await requestVpsAgent({
        project: loaded.project,
        method: "POST",
        path: `/v1/vps/${loaded.project.vps_code}/files/actions`,
        body: { action, path, targetPath, type: nodeType },
        timeoutMs: 15_000,
      });
      agentOk = true;
    } catch {
      agentOk = false;
    }

    const nextTree = sortTree(upsertRuntimeFileTree(currentTree, action, path, targetPath, nodeType));
    const fileContents = isRecord(currentPayload.fileContents)
      ? { ...currentPayload.fileContents } as Record<string, string>
      : {};
    if (action === "create-file") fileContents[path] = fileContents[path] || "";
    if (action === "delete") {
      for (const key of Object.keys(fileContents)) {
        if (key === path || key.startsWith(`${path}/`)) delete fileContents[key];
      }
    }
    if ((action === "rename" || action === "move") && targetPath) {
      for (const key of Object.keys(fileContents)) {
        if (key === path || key.startsWith(`${path}/`)) {
          const nextKey = key === path ? targetPath : key.replace(`${path}/`, `${targetPath}/`);
          fileContents[nextKey] = fileContents[key];
          delete fileContents[key];
        }
      }
    }

    await updateRuntimeFilesPayload({
      projectId: loaded.project.id,
      currentPayload,
      tree: nextTree,
      fileContents,
    });
    await appendVpsEvent({
      projectId: loaded.project.id,
      userId: loaded.session.user.id,
      action: "file_write",
      status: "succeeded",
      message: `${action} ${path}${targetPath ? ` -> ${targetPath}` : ""}.`,
      responsePayload: { agentConnected: agentOk },
    });
    return applyNoStoreHeaders(
      NextResponse.json({ ok: true, tree: nextTree, agentConnected: agentOk }),
    );
  }

  const content = typeof body.content === "string" ? body.content : null;
  if (!path || content === null) {
    return applyNoStoreHeaders(
      NextResponse.json({ ok: false, message: "Arquivo invalido." }, { status: 400 }),
    );
  }
  const fileContents = isRecord(currentPayload.fileContents)
    ? { ...currentPayload.fileContents } as Record<string, string>
    : {};
  const token = await readHostingGitHubToken(loaded.project.user_id);
  let githubCommit: Awaited<ReturnType<typeof commitHostingGitHubRepositoryFile>> | null = null;
  let githubCommitSource: "oauth" | "github_app" = "oauth";
  const appInstallUrl = buildHostingGitHubAppInstallUrl();
  const commitWithToken = (nextToken: string) => commitHostingGitHubRepositoryFile(
    buildGitHubCommitPayload({
      token: nextToken,
      owner: loaded.project.github_owner,
      repo: loaded.project.github_repo,
      branch: loaded.project.github_branch,
      path,
      content,
      vpsCode: loaded.project.vps_code,
    }),
  );
  const tryGitHubAppCommit = async () => {
    const installation = await readHostingGitHubInstallationTokenForRepository({
      owner: loaded.project.github_owner,
      repo: loaded.project.github_repo,
    });
    if (!installation?.token) return null;
    const commit = await commitWithToken(installation.token);
    githubCommitSource = "github_app";
    return commit;
  };

  if (token) {
    try {
      githubCommit = await commitWithToken(token);
    } catch (error) {
      if (error instanceof HostingGitHubApiError && error.status === 401) {
        const refreshedToken = await readHostingGitHubStoredToken(loaded.project.user_id);
        if (refreshedToken && refreshedToken !== token) {
          try {
            githubCommit = await commitWithToken(refreshedToken);
          } catch (retryError) {
            githubCommit = await tryGitHubAppCommit().catch(() => null);
            if (!githubCommit) {
              if (retryError instanceof HostingGitHubApiError && retryError.status === 403) {
                return applyNoStoreHeaders(
                  NextResponse.json(
                    {
                      ok: false,
                      reconnectRequired: true,
                      reauthorizeRequired: true,
                      ssoUrl: retryError.ssoUrl,
                      installAppUrl: appInstallUrl,
                      message: buildGitHubWritePermissionMessage(retryError),
                    },
                    { status: 403 },
                  ),
                );
              }
              return applyNoStoreHeaders(
                NextResponse.json(
                  { ok: false, reconnectRequired: true, installAppUrl: appInstallUrl, message: "Reconecte o GitHub para renovar a permissao de escrita deste repositorio." },
                  { status: 401 },
                ),
              );
            }
          }
        }
      }
      if (githubCommit) {
        // Retry with stored/refresh token succeeded.
      } else if (error instanceof HostingGitHubApiError && error.status === 403) {
        githubCommit = await tryGitHubAppCommit().catch(() => null);
        if (githubCommit) {
          // GitHub App installation token succeeded.
        } else {
        return applyNoStoreHeaders(
          NextResponse.json(
            {
              ok: false,
              reconnectRequired: true,
              reauthorizeRequired: true,
              ssoUrl: error.ssoUrl,
              installAppUrl: appInstallUrl,
              message: buildGitHubWritePermissionMessage(error),
            },
            { status: 403 },
          ),
        );
        }
      } else
      if (isPermanentHostingGitHubAuthError(error)) {
        githubCommit = await tryGitHubAppCommit().catch(() => null);
        if (githubCommit) {
          // GitHub App installation token succeeded.
        } else {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, reconnectRequired: true, installAppUrl: appInstallUrl, message: "Reconecte o GitHub para enviar esta alteracao ao repositorio." },
            { status: 401 },
          ),
        );
        }
      }
      if (!githubCommit) {
        return applyNoStoreHeaders(
          NextResponse.json(
            { ok: false, message: error instanceof Error ? error.message : "Nao consegui criar commit no GitHub." },
            { status: 502 },
          ),
        );
      }
    }
  } else {
    githubCommit = await tryGitHubAppCommit().catch(() => null);
    if (!githubCommit) {
      return applyNoStoreHeaders(
        NextResponse.json(
          { ok: false, reconnectRequired: true, installAppUrl: appInstallUrl, message: "Conecte o GitHub ou instale o GitHub App Flowdesk para salvar e commitar alteracoes no repositorio." },
          { status: 401 },
        ),
      );
    }
  }

  fileContents[path] = content;
  await updateRuntimeFilesPayload({
    projectId: loaded.project.id,
    currentPayload,
    tree: currentTree,
    fileContents,
  }).catch(() => null);

  let agentOk = false;
  try {
    await requestVpsAgent({
      project: loaded.project,
      method: "POST",
      path: `/v1/vps/${loaded.project.vps_code}/files`,
      body: { path, content },
      timeoutMs: 15_000,
    });
    agentOk = true;
  } catch {
    agentOk = false;
  }

  const savedThroughBranch = githubCommit?.mode === "branch";
  const successMessage = savedThroughBranch
    ? githubCommit?.pullRequestUrl
      ? `Alteracao enviada para a branch ${githubCommit.branch} e PR #${githubCommit.pullRequestNumber || ""} preparado.`
      : `Alteracao enviada para a branch ${githubCommit.branch}.`
    : githubCommit?.commitSha
      ? `Commit ${githubCommit.commitSha.slice(0, 7)} enviado ao GitHub.`
      : "Alteracao enviada ao GitHub.";

  await appendVpsEvent({
    projectId: loaded.project.id,
    userId: loaded.session.user.id,
    action: "file_write",
    status: "succeeded",
    message: savedThroughBranch
      ? `Arquivo ${path} salvo em branch Flowdesk por protecao da branch principal.`
      : `Arquivo ${path} salvo e commitado no GitHub.`,
    responsePayload: {
      source: githubCommitSource,
      agentConnected: agentOk,
      commit: githubCommit,
    },
  });

  if (!agentOk) {
    await getSupabaseAdminClientOrThrow().from("hosting_vps_logs").insert({
      hosting_project_id: loaded.project.id,
      level: "warn",
      source: "files",
      message: `Arquivo ${path} commitado no GitHub, mas o agente VPS nao confirmou escrita local agora.`,
      metadata: { path, commit: githubCommit, source: githubCommitSource },
    });
  }

  return applyNoStoreHeaders(
    NextResponse.json({
      ok: true,
      source: githubCommitSource,
      agentConnected: agentOk,
      commit: githubCommit,
      message: successMessage,
    }),
  );
}
