import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { getServerEnv, getServerEnvList } from "@/lib/serverEnv";
import { applyStandardSecurityHeaders } from "@/lib/security/http";
import { flowSecureDto } from "@/lib/security/flowSecure";

export type FlowSecurePolishMode = "auto" | "lossless" | "lossy";
export type FlowSecurePolishFormat =
  | "auto"
  | "original"
  | "avif"
  | "webp"
  | "jpeg"
  | "png";
export type FlowSecurePolishFit = "cover" | "contain" | "inside";
type FlowSecurePolishSourceKind = "local" | "remote" | "inline";

type FlowSecurePolishRequest = {
  source: string;
  width?: number;
  height?: number;
  quality?: number;
  mode: FlowSecurePolishMode;
  format: FlowSecurePolishFormat;
  fit: FlowSecurePolishFit;
};

type SourceAsset =
  | {
      kind: "local";
      source: string;
      sourceLabel: string;
      contentType: string;
      buffer: Buffer;
      lastModifiedMs: number;
    }
  | {
      kind: "remote";
      source: string;
      sourceLabel: string;
      contentType: string;
      buffer: Buffer;
      lastModifiedMs: number;
    }
  | {
      kind: "inline";
      source: string;
      sourceLabel: string;
      contentType: string;
      buffer: Buffer;
      lastModifiedMs: number;
    };

type OptimizeResult = {
  body: Buffer;
  contentType: string;
  etag: string;
  cacheControl: string;
  contentDisposition: string;
  optimization: "lossless" | "lossy" | "bypass";
  outputFormat: string;
  bytesIn: number;
  bytesOut: number;
  bytesSaved: number;
  sourceKind: FlowSecurePolishSourceKind;
};

type CacheEntry = {
  expiresAtMs: number;
  result: OptimizeResult;
};

const DEFAULT_ALLOWED_REMOTE_HOSTS = [
  "cdn.discordapp.com",
  "media.discordapp.net",
  "images-ext-1.discordapp.net",
  "images-ext-2.discordapp.net",
  "cdn.flwdesk.com",
] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const CONTENT_TYPE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/avif": ".avif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/gif": ".gif",
};

const imageCache = new Map<string, CacheEntry>();

class FlowSecureImagePolishError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    input?: {
      code?: string;
      status?: number;
    },
  ) {
    super(message);
    this.name = "FlowSecureImagePolishError";
    this.code = input?.code || "flowsecure_image_polish_error";
    this.status = input?.status || 400;
  }
}

export function isFlowSecureImagePolishError(
  value: unknown,
): value is FlowSecureImagePolishError {
  return value instanceof FlowSecureImagePolishError;
}

function isExplicitlyEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveIntegerEnv(name: string, fallback: number) {
  const rawValue = getServerEnv(name) ?? process.env[name];
  if (!rawValue?.trim()) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function resolveAllowedRemoteHosts() {
  return new Set(
    [...DEFAULT_ALLOWED_REMOTE_HOSTS, ...getServerEnvList("FLOWSECURE_IMAGE_POLISH_ALLOWED_REMOTE_HOSTS")]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseFlowSecurePolishRequest(url: URL): FlowSecurePolishRequest {
  const raw = Object.fromEntries(url.searchParams.entries());
  const source = flowSecureDto.string({
    minLength: 1,
    maxLength: 16_384,
    disallowAngleBrackets: true,
    rejectThreatPatterns: true,
  })(raw.src, "src");

  const mode = flowSecureDto.optional(
    flowSecureDto.enum(["auto", "lossless", "lossy"] as const),
  )(raw.mode, "mode");

  const format = flowSecureDto.optional(
    flowSecureDto.enum(["auto", "original", "avif", "webp", "jpeg", "png"] as const),
  )(raw.format, "format");

  const fit = flowSecureDto.optional(
    flowSecureDto.enum(["cover", "contain", "inside"] as const),
  )(raw.fit, "fit");

  const width = flowSecureDto.optional(
    flowSecureDto.number({ integer: true, min: 16, max: 4096 }),
  )(raw.w, "w");

  const height = flowSecureDto.optional(
    flowSecureDto.number({ integer: true, min: 16, max: 4096 }),
  )(raw.h, "h");

  const quality = flowSecureDto.optional(
    flowSecureDto.number({ integer: true, min: 35, max: 100 }),
  )(raw.q, "q");

  return {
    source,
    width,
    height,
    quality,
    mode: mode || "auto",
    format: format || "auto",
    fit: fit || "inside",
  };
}

function normalizeMimeType(contentType: string | null | undefined) {
  return (contentType || "").split(";")[0]?.trim().toLowerCase() || "";
}

function resolveContentTypeFromPath(filePath: string) {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function buildPolishError(
  message: string,
  input?: {
    code?: string;
    status?: number;
  },
) {
  return new FlowSecureImagePolishError(message, input);
}

function isWithinRoot(resolvedPath: string, root: string) {
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return resolvedPath === root || resolvedPath.startsWith(normalizedRoot);
}

function resolveFilePathWithinRoot(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath);
  if (!isWithinRoot(resolved, root)) {
    throw buildPolishError("Caminho de imagem fora do diretorio permitido.", {
      status: 403,
    });
  }

  return resolved;
}

function resolveLocalFilePath(sourcePath: string) {
  const normalized = flowSecureDto.internalPath()(sourcePath, "src");
  if (normalized === "/api/flowsecure/polish") {
    throw buildPolishError("Loop de otimizacao detectado.", {
      status: 400,
    });
  }

  if (normalized.startsWith("/_next/static/media/")) {
    const mediaRoot = path.resolve(process.cwd(), ".next", "static", "media");
    const relativePath = normalized.replace(/^\/_next\/static\/media\/+/, "");
    return resolveFilePathWithinRoot(mediaRoot, relativePath);
  }

  const publicRoot = path.resolve(process.cwd(), "public");
  return resolveFilePathWithinRoot(publicRoot, normalized.replace(/^\/+/, ""));
}

async function readLocalAsset(sourcePath: string): Promise<SourceAsset> {
  const resolvedPath = resolveLocalFilePath(sourcePath);
  const fileStat = await stat(resolvedPath);
  const buffer = await readFile(resolvedPath);

  return {
    kind: "local",
    source: sourcePath,
    sourceLabel: resolvedPath,
    contentType: resolveContentTypeFromPath(resolvedPath),
    buffer,
    lastModifiedMs: fileStat.mtimeMs,
  };
}

function readInlineAsset(sourceDataUrl: string): SourceAsset {
  const separatorIndex = sourceDataUrl.indexOf(",");
  if (!sourceDataUrl.startsWith("data:") || separatorIndex <= 5) {
    throw buildPolishError("Data URL de imagem invalida.", {
      status: 400,
    });
  }

  const metadata = sourceDataUrl.slice(5, separatorIndex);
  const payload = sourceDataUrl.slice(separatorIndex + 1);
  const metadataParts = metadata
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  const mimeType = normalizeMimeType(metadataParts[0] || "");
  const isBase64 = metadataParts.some(
    (value) => value.toLowerCase() === "base64",
  );

  if (!mimeType.startsWith("image/")) {
    throw buildPolishError("A Data URL precisa conter uma imagem valida.", {
      status: 415,
    });
  }

  if (!isBase64) {
    throw buildPolishError("O FlowSecure Polish exige imagens inline em base64.", {
      status: 415,
    });
  }

  const maxSourceBytes = resolveIntegerEnv(
    "FLOWSECURE_IMAGE_POLISH_MAX_SOURCE_BYTES",
    12 * 1024 * 1024,
  );

  let buffer: Buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch {
    throw buildPolishError("Falha ao decodificar a imagem inline.", {
      status: 400,
    });
  }

  if (!buffer.length) {
    throw buildPolishError("A imagem inline esta vazia.", {
      status: 400,
    });
  }

  if (buffer.length > maxSourceBytes) {
    throw buildPolishError("A imagem inline excede o limite maximo permitido.", {
      status: 413,
    });
  }

  return {
    kind: "inline",
    source: sourceDataUrl,
    sourceLabel: "data:image",
    contentType: mimeType,
    buffer,
    lastModifiedMs: 0,
  };
}

function assertAllowedRemoteUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw buildPolishError("URL remota invalida para o FlowSecure Polish.", {
      status: 400,
    });
  }

  if (url.protocol !== "https:") {
    throw buildPolishError("Apenas URLs HTTPS sao permitidas.", {
      status: 400,
    });
  }

  if (url.pathname === "/api/flowsecure/polish") {
    throw buildPolishError("Loop de otimizacao remoto detectado.", {
      status: 400,
    });
  }

  const allowedHosts = resolveAllowedRemoteHosts();
  const hostname = url.hostname.trim().toLowerCase();
  if (
    !allowedHosts.has(hostname) &&
    !hostname.endsWith(".flwdesk.com")
  ) {
    throw buildPolishError("Host remoto nao permitido para o FlowSecure Polish.", {
      status: 403,
    });
  }

  return url;
}

async function readRemoteAsset(sourceUrl: string): Promise<SourceAsset> {
  const url = assertAllowedRemoteUrl(sourceUrl);
  const timeoutMs = resolveIntegerEnv("FLOWSECURE_IMAGE_POLISH_FETCH_TIMEOUT_MS", 12_000);
  const maxSourceBytes = resolveIntegerEnv("FLOWSECURE_IMAGE_POLISH_MAX_SOURCE_BYTES", 12 * 1024 * 1024);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "force-cache",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw buildPolishError(`Falha ao buscar imagem remota: HTTP ${response.status}`, {
        status: response.status >= 500 ? 502 : 400,
      });
    }

    const contentType = normalizeMimeType(response.headers.get("content-type"));
    if (!contentType.startsWith("image/")) {
      throw buildPolishError("A origem remota nao retornou uma imagem valida.", {
        status: 415,
      });
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > maxSourceBytes) {
      throw buildPolishError("A imagem remota excede o limite maximo permitido.", {
        status: 413,
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > maxSourceBytes) {
      throw buildPolishError("A imagem remota excede o limite maximo permitido.", {
        status: 413,
      });
    }

    const lastModifiedRaw = response.headers.get("last-modified");
    const lastModifiedMs = lastModifiedRaw ? Date.parse(lastModifiedRaw) : Number.NaN;

    return {
      kind: "remote",
      source: sourceUrl,
      sourceLabel: url.toString(),
      contentType,
      buffer,
      lastModifiedMs: Number.isFinite(lastModifiedMs)
        ? lastModifiedMs
        : Date.now(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveSourceAsset(source: string) {
  if (source.startsWith("data:image/")) {
    return readInlineAsset(source);
  }

  if (source.startsWith("/")) {
    return readLocalAsset(source);
  }

  return readRemoteAsset(source);
}

function cleanupCache(nowMs: number) {
  for (const [key, entry] of imageCache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      imageCache.delete(key);
    }
  }
}

function trimCacheToLimit() {
  const maxEntries = resolveIntegerEnv(
    "FLOWSECURE_IMAGE_POLISH_MAX_CACHE_ENTRIES",
    600,
  );
  const overflow = imageCache.size - maxEntries;
  if (overflow <= 0) {
    return;
  }

  let removed = 0;
  for (const key of imageCache.keys()) {
    imageCache.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

function buildCacheKey(input: {
  source: SourceAsset;
  request: FlowSecurePolishRequest;
  wantsAvif: boolean;
  wantsWebp: boolean;
}) {
  return JSON.stringify({
    source: input.source.source,
    sourceKind: input.source.kind,
    lastModifiedMs: Math.trunc(input.source.lastModifiedMs),
    width: input.request.width || null,
    height: input.request.height || null,
    quality: input.request.quality || null,
    mode: input.request.mode,
    format: input.request.format,
    fit: input.request.fit,
    wantsAvif: input.wantsAvif,
    wantsWebp: input.wantsWebp,
  });
}

function shouldBypassOptimization(input: {
  source: SourceAsset;
  format: string;
  metadata: sharp.Metadata;
}) {
  if (input.format === "svg") {
    return true;
  }

  if ((input.metadata.pages || 1) > 1) {
    return true;
  }

  if (
    input.source.contentType === "image/gif" ||
    input.source.contentType === "image/svg+xml"
  ) {
    return true;
  }

  return false;
}

function resolveAutoMode(input: {
  sourceFormat: string;
  metadata: sharp.Metadata;
  sourceBytes: number;
}) {
  const area = (input.metadata.width || 0) * (input.metadata.height || 0);
  const hasAlpha = input.metadata.hasAlpha === true;
  const isPngLike = input.sourceFormat === "png" || input.sourceFormat === "webp";
  const shouldPreferLossless =
    hasAlpha && area <= 1_200 * 1_200 && input.sourceBytes <= 650_000;

  if (shouldPreferLossless) {
    return "lossless" as const;
  }

  if (isPngLike && area <= 420 * 420 && input.sourceBytes <= 180_000) {
    return "lossless" as const;
  }

  return "lossy" as const;
}

function normalizeOutputFormatName(
  format: string,
  metadata: sharp.Metadata,
): "avif" | "jpeg" | "png" | "webp" {
  const normalized = format.trim().toLowerCase();
  if (normalized === "avif") return "avif";
  if (normalized === "webp") return "webp";
  if (normalized === "png") return "png";
  if (normalized === "jpg" || normalized === "jpeg") return "jpeg";
  if (normalized === "gif" || normalized === "svg") {
    return metadata.hasAlpha ? "png" : "jpeg";
  }

  return metadata.hasAlpha ? "png" : "jpeg";
}

function resolveOutputFormat(input: {
  requestedFormat: FlowSecurePolishFormat;
  effectiveMode: Exclude<FlowSecurePolishMode, "auto">;
  sourceFormat: string;
  metadata: sharp.Metadata;
  wantsAvif: boolean;
  wantsWebp: boolean;
}) {
  if (input.requestedFormat !== "auto") {
    if (input.requestedFormat === "original") {
      return normalizeOutputFormatName(input.sourceFormat, input.metadata);
    }

    if (input.effectiveMode === "lossless" && input.requestedFormat === "jpeg") {
      return input.wantsWebp ? "webp" : "png";
    }

    return normalizeOutputFormatName(input.requestedFormat, input.metadata);
  }

  if (input.effectiveMode === "lossless") {
    if (input.wantsWebp) {
      return "webp";
    }

    return input.metadata.hasAlpha
      ? "png"
      : normalizeOutputFormatName(input.sourceFormat || "jpeg", input.metadata);
  }

  if (input.wantsAvif && !input.metadata.hasAlpha) {
    return "avif";
  }

  if (input.wantsWebp) {
    return "webp";
  }

  return input.metadata.hasAlpha ? "png" : "jpeg";
}

function optimizeWithSharp(input: {
  request: FlowSecurePolishRequest;
  source: SourceAsset;
  sourceFormat: string;
  metadata: sharp.Metadata;
  wantsAvif: boolean;
  wantsWebp: boolean;
}) {
  const defaultQuality = resolveIntegerEnv("FLOWSECURE_IMAGE_POLISH_DEFAULT_QUALITY", 78);
  const avifQuality = resolveIntegerEnv("FLOWSECURE_IMAGE_POLISH_AVIF_QUALITY", 62);
  const pngQuality = resolveIntegerEnv("FLOWSECURE_IMAGE_POLISH_PNG_QUALITY", 92);
  const effectiveMode =
    input.request.mode === "auto"
      ? resolveAutoMode({
          sourceFormat: input.sourceFormat,
          metadata: input.metadata,
          sourceBytes: input.source.buffer.length,
        })
      : input.request.mode;

  const outputFormat = resolveOutputFormat({
    requestedFormat: input.request.format,
    effectiveMode,
    sourceFormat: input.sourceFormat,
    metadata: input.metadata,
    wantsAvif: input.wantsAvif,
    wantsWebp: input.wantsWebp,
  });

  const quality = input.request.quality || defaultQuality;

  let pipeline = sharp(input.source.buffer, {
    animated: false,
    limitInputPixels: resolveIntegerEnv("FLOWSECURE_IMAGE_POLISH_MAX_INPUT_PIXELS", 48_000_000),
  }).rotate();

  if (input.request.width || input.request.height) {
    pipeline = pipeline.resize({
      width: input.request.width,
      height: input.request.height,
      fit: input.request.fit,
      withoutEnlargement: true,
    });
  }

  if (outputFormat === "avif") {
    pipeline = pipeline.avif({
      quality: Math.min(quality, avifQuality),
      effort: 5,
      chromaSubsampling: "4:2:0",
    });
  } else if (outputFormat === "webp") {
    pipeline = pipeline.webp(
      effectiveMode === "lossless"
        ? {
            lossless: true,
            quality: 100,
            effort: 6,
          }
        : {
            quality,
            alphaQuality: Math.min(100, quality + 6),
            effort: 6,
          },
    );
  } else if (outputFormat === "png") {
    pipeline = pipeline.png({
      quality: effectiveMode === "lossless" ? 100 : Math.max(quality, pngQuality),
      compressionLevel: 9,
      palette: true,
      effort: 10,
    });
  } else {
    pipeline = pipeline.jpeg({
      quality: effectiveMode === "lossless" ? 100 : quality,
      mozjpeg: true,
      chromaSubsampling: effectiveMode === "lossless" ? "4:4:4" : "4:2:0",
    });
  }

  return {
    pipeline,
    effectiveMode,
    outputFormat,
  };
}

function buildContentDisposition(source: string, contentType: string) {
  const extension =
    CONTENT_TYPE_EXTENSION_BY_MIME[contentType] ||
    path.extname(source).toLowerCase() ||
    ".img";
  let sourceBaseName = source;

  if (source.startsWith("http://") || source.startsWith("https://")) {
    try {
      sourceBaseName = path.posix.basename(new URL(source).pathname) || sourceBaseName;
    } catch {
      sourceBaseName = source;
    }
  } else if (source.startsWith("data:image/")) {
    sourceBaseName = `flowsecure-inline-${crypto
      .createHash("sha256")
      .update(source)
      .digest("hex")
      .slice(0, 10)}`;
  }

  const baseName =
    path.basename(sourceBaseName, path.extname(sourceBaseName)).replace(/[^a-z0-9._-]+/gi, "-") ||
    "flowsecure-image";

  return `inline; filename="${baseName}${extension}"`;
}

async function generateOptimizedImage(
  request: FlowSecurePolishRequest,
  source: SourceAsset,
  input: {
    wantsAvif: boolean;
    wantsWebp: boolean;
  },
): Promise<OptimizeResult> {
  const metadata = await sharp(source.buffer, {
    animated: true,
    limitInputPixels: resolveIntegerEnv("FLOWSECURE_IMAGE_POLISH_MAX_INPUT_PIXELS", 48_000_000),
  }).metadata();

  const rawSourceFormat = (metadata.format || normalizeMimeType(source.contentType).replace("image/", "")).toLowerCase();
  if (shouldBypassOptimization({ source, format: rawSourceFormat, metadata })) {
    const contentType = normalizeMimeType(source.contentType) || "application/octet-stream";
    const etag = `"${crypto.createHash("sha256").update(source.buffer).digest("base64url").slice(0, 27)}"`;
    return {
      body: source.buffer,
      contentType,
      etag,
      cacheControl: "public, max-age=86400, stale-while-revalidate=604800",
      contentDisposition: buildContentDisposition(source.source, contentType),
      optimization: "bypass",
      outputFormat: rawSourceFormat || "original",
      bytesIn: source.buffer.length,
      bytesOut: source.buffer.length,
      bytesSaved: 0,
      sourceKind: source.kind,
    };
  }

  const sourceFormat = normalizeOutputFormatName(rawSourceFormat, metadata);

  const { pipeline, effectiveMode, outputFormat } = optimizeWithSharp({
    request,
    source,
    sourceFormat,
    metadata,
    wantsAvif: input.wantsAvif,
    wantsWebp: input.wantsWebp,
  });

  const body = await pipeline.toBuffer();
  const contentType =
    outputFormat === "avif"
      ? "image/avif"
      : outputFormat === "webp"
        ? "image/webp"
        : outputFormat === "png"
          ? "image/png"
          : "image/jpeg";

  const etag = `"${crypto.createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;

  return {
    body,
    contentType,
    etag,
    cacheControl: "public, max-age=86400, stale-while-revalidate=604800",
    contentDisposition: buildContentDisposition(source.source, contentType),
    optimization: effectiveMode,
    outputFormat,
    bytesIn: source.buffer.length,
    bytesOut: body.length,
    bytesSaved: Math.max(0, source.buffer.length - body.length),
    sourceKind: source.kind,
  };
}

function resolveCacheTtlSeconds() {
  return resolveIntegerEnv("FLOWSECURE_IMAGE_POLISH_CACHE_TTL_SECONDS", 3600);
}

function resolveCapabilities(acceptHeader: string | null) {
  const accept = (acceptHeader || "").toLowerCase();
  return {
    wantsAvif: accept.includes("image/avif"),
    wantsWebp: accept.includes("image/webp"),
  };
}

function matchIfNoneMatch(requestHeaders: Headers, etag: string) {
  const ifNoneMatch = requestHeaders.get("if-none-match");
  if (!ifNoneMatch) {
    return false;
  }

  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .includes(etag);
}

function buildResponse(
  result: OptimizeResult,
  input: {
    requestHeaders: Headers;
    requestId: string;
    isHead?: boolean;
  },
) {
  const status = matchIfNoneMatch(input.requestHeaders, result.etag) ? 304 : 200;
  const response = new NextResponse(
    status === 304 || input.isHead ? null : new Uint8Array(result.body),
    {
    status,
    headers: {
      "Content-Type": result.contentType,
    },
  });

  applyStandardSecurityHeaders(response, {
    requestId: input.requestId,
    noIndex: true,
  });

  response.headers.set("Cache-Control", result.cacheControl);
  response.headers.set("Content-Disposition", result.contentDisposition);
  response.headers.set("ETag", result.etag);
  response.headers.set("Vary", "Accept");
  response.headers.set("X-FlowSecure-Image-Polish", result.optimization);
  response.headers.set("X-FlowSecure-Image-Format", result.outputFormat);
  response.headers.set("X-FlowSecure-Image-Source", result.sourceKind);
  response.headers.set("X-FlowSecure-Image-Bytes-In", String(result.bytesIn));
  response.headers.set("X-FlowSecure-Image-Bytes-Out", String(result.bytesOut));
  response.headers.set("X-FlowSecure-Image-Bytes-Saved", String(result.bytesSaved));

  if (status !== 304) {
    response.headers.set("Content-Length", String(result.body.length));
  }

  return response;
}

export async function handleFlowSecurePolishRequest(input: {
  url: URL;
  headers: Headers;
  requestId: string;
  method: "GET" | "HEAD";
}) {
  if (!isExplicitlyEnabled(getServerEnv("FLOWSECURE_IMAGE_POLISH_ENABLED") ?? "1")) {
    return NextResponse.json(
      { ok: false, message: "FlowSecure Polish desativado no ambiente." },
      { status: 503 },
    );
  }

  const request = parseFlowSecurePolishRequest(input.url);
  const capabilities = resolveCapabilities(input.headers.get("accept"));
  const source = await resolveSourceAsset(request.source);

  cleanupCache(Date.now());
  const cacheKey = buildCacheKey({
    source,
    request,
    wantsAvif: capabilities.wantsAvif,
    wantsWebp: capabilities.wantsWebp,
  });

  const cached = imageCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now()) {
    imageCache.delete(cacheKey);
    imageCache.set(cacheKey, cached);
    return buildResponse(cached.result, {
      requestHeaders: input.headers,
      requestId: input.requestId,
      isHead: input.method === "HEAD",
    });
  }

  const result = await generateOptimizedImage(request, source, capabilities);
  imageCache.delete(cacheKey);
  imageCache.set(cacheKey, {
    expiresAtMs: Date.now() + resolveCacheTtlSeconds() * 1000,
    result,
  });
  trimCacheToLimit();

  return buildResponse(result, {
    requestHeaders: input.headers,
    requestId: input.requestId,
    isHead: input.method === "HEAD",
  });
}
