import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(process.cwd());
const sourceGlobs = [
  "app",
  "components",
  "lib",
];
const envCache = new Map();

const findings = [];

function pushFinding(severity, message, file = null) {
  findings.push({
    severity,
    message,
    file,
  });
}

function walk(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") {
        continue;
      }
      files.push(...walk(fullPath));
      continue;
    }

    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function unescapeEnvValue(value) {
  return value
    .replace(/\\\$/g, "$")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r");
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const rawValue = line.slice(separatorIndex + 1).trim();
    envCache.set(key, unescapeEnvValue(stripWrappingQuotes(rawValue)));
  }
}

function primeEnvCache() {
  if (envCache.size > 0) {
    return;
  }

  const candidates = [
    path.resolve(rootDir, "..", ".env"),
    path.resolve(rootDir, "..", ".env.local"),
    path.resolve(rootDir, ".env"),
    path.resolve(rootDir, ".env.local"),
  ];

  for (const candidate of candidates) {
    parseEnvFile(candidate);
  }
}

function readEnvValue(name) {
  const runtimeValue = process.env[name];
  if (typeof runtimeValue === "string" && runtimeValue.trim()) {
    return runtimeValue.trim();
  }

  primeEnvCache();
  const cachedValue = envCache.get(name);
  return typeof cachedValue === "string" ? cachedValue.trim() : "";
}

function hasAnyEnvValue(names) {
  return names.some((name) => Boolean(readEnvValue(name)));
}

function readProjectFiles() {
  return sourceGlobs.flatMap((segment) => walk(path.join(rootDir, segment)));
}

function scanForDangerousPatterns(files) {
  const dangerousPatterns = [
    {
      pattern: /dangerouslySetInnerHTML/,
      message: "Uso de dangerouslySetInnerHTML detectado.",
      severity: "high",
    },
    {
      pattern: /\binnerHTML\s*=/,
      message: "Atribuicao direta a innerHTML detectada.",
      severity: "high",
    },
    {
      pattern: /\beval\s*\(/,
      message: "Uso de eval detectado.",
      severity: "critical",
    },
    {
      pattern: /\bnew Function\s*\(/,
      message: "Uso de new Function detectado.",
      severity: "critical",
    },
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const entry of dangerousPatterns) {
      if (entry.pattern.test(content)) {
        pushFinding(entry.severity, entry.message, file);
      }
    }
  }
}

function scanSensitiveRoutesForRawJson(files) {
  const sensitiveRoutePattern =
    /app[\\/]+api[\\/]+auth|app[\\/]+api[\\/]+payments|app[\\/]+api[\\/]+internal/i;

  for (const file of files) {
    if (!sensitiveRoutePattern.test(file)) {
      continue;
    }

    const content = fs.readFileSync(file, "utf8");
    if (!/request\.json\s*\(/.test(content)) {
      continue;
    }

    if (!/parseFlowSecureDto(?:<[^>]+>)?\s*\(/.test(content)) {
      pushFinding(
        "medium",
        "Rota sensivel com request.json sem parseFlowSecureDto detectado.",
        file,
      );
    }
  }
}

function scanSecurityFallbacks() {
  const masterKey = readEnvValue("FLOWSECURE_MASTER_KEY") || readEnvValue("FLOWSECURE_MASTER_SECRET");
  const passwordPepper = readEnvValue("AUTH_PASSWORD_PEPPER");

  if (!masterKey) {
    pushFinding(
      "high",
      "FLOWSECURE_MASTER_KEY/FLOWSECURE_MASTER_SECRET ausente no ambiente atual.",
    );
  }

  if (!passwordPepper) {
    pushFinding(
      "high",
      "AUTH_PASSWORD_PEPPER ausente no ambiente atual.",
    );
  }
}

function scanProductionSecrets() {
  const requiredSecretGroups = [
    {
      label: "NEXT_PUBLIC_APP_URL/APP_URL/SITE_URL",
      names: ["NEXT_PUBLIC_APP_URL", "APP_URL", "SITE_URL"],
    },
    {
      label: "NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL",
      names: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
    },
    {
      label: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      names: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    },
    {
      label: "SUPABASE_SERVICE_ROLE_KEY",
      names: ["SUPABASE_SERVICE_ROLE_KEY"],
    },
    {
      label: "AUTH_SECRET/NEXTAUTH_SECRET",
      names: ["AUTH_SECRET", "NEXTAUTH_SECRET"],
    },
    {
      label: "AUTH_COOKIE_SECRET/AUTH_SECRET/NEXTAUTH_SECRET",
      names: ["AUTH_COOKIE_SECRET", "AUTH_SECRET", "NEXTAUTH_SECRET"],
    },
    {
      label: "AUTH_PASSWORD_PEPPER",
      names: ["AUTH_PASSWORD_PEPPER"],
    },
    {
      label: "AUTH_REMEMBER_DEVICE_SECRET/AUTH_SECRET/NEXTAUTH_SECRET",
      names: ["AUTH_REMEMBER_DEVICE_SECRET", "AUTH_SECRET", "NEXTAUTH_SECRET"],
    },
    {
      label: "AUTH_AUDIT_HASH_SALT/AUTH_SECRET/NEXTAUTH_SECRET",
      names: ["AUTH_AUDIT_HASH_SALT", "AUTH_SECRET", "NEXTAUTH_SECRET"],
    },
    {
      label: "FLOWSECURE_MASTER_KEY/FLOWSECURE_MASTER_SECRET",
      names: ["FLOWSECURE_MASTER_KEY", "FLOWSECURE_MASTER_SECRET"],
    },
    {
      label: "CRON_SECRET",
      names: ["CRON_SECRET"],
    },
    {
      label: "FLOWAI_INTERNAL_API_TOKEN/CRON_SECRET",
      names: ["FLOWAI_INTERNAL_API_TOKEN", "CRON_SECRET"],
    },
    {
      label: "FLOWAI_INTERNAL_SIGNING_SECRET/FLOWAI_INTERNAL_API_TOKEN/CRON_SECRET",
      names: ["FLOWAI_INTERNAL_SIGNING_SECRET", "FLOWAI_INTERNAL_API_TOKEN", "CRON_SECRET"],
    },
    {
      label: "TRANSCRIPT_ACCESS_SECRET/SUPABASE_SERVICE_ROLE_KEY",
      names: ["TRANSCRIPT_ACCESS_SECRET", "SUPABASE_SERVICE_ROLE_KEY"],
    },
    {
      label: "PAYMENT_LINK_SECRET/AUTH_SECRET/NEXTAUTH_SECRET",
      names: ["PAYMENT_LINK_SECRET", "AUTH_SECRET", "NEXTAUTH_SECRET"],
    },
    {
      label: "DISCORD_CLIENT_ID",
      names: ["DISCORD_CLIENT_ID"],
    },
    {
      label: "DISCORD_CLIENT_SECRET",
      names: ["DISCORD_CLIENT_SECRET"],
    },
    {
      label: "DISCORD_BOT_TOKEN/DISCORD_TOKEN",
      names: ["DISCORD_BOT_TOKEN", "DISCORD_TOKEN"],
    },
    {
      label: "OPENAI_API_KEY",
      names: ["OPENAI_API_KEY"],
    },
    {
      label: "AUTH_SMTP_HOST",
      names: ["AUTH_SMTP_HOST"],
    },
    {
      label: "AUTH_SMTP_FROM_EMAIL/AUTH_SMTP_USER",
      names: ["AUTH_SMTP_FROM_EMAIL", "AUTH_SMTP_USER"],
    },
    {
      label: "MERCADO_PAGO_ACCESS_TOKEN/MERCADO_PAGO_PIX_ACCESS_TOKEN",
      names: ["MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_PIX_ACCESS_TOKEN"],
    },
    {
      label: "MERCADO_PAGO_WEBHOOK_TOKEN",
      names: ["MERCADO_PAGO_WEBHOOK_TOKEN"],
    },
    {
      label: "MERCADO_PAGO_WEBHOOK_SIGNATURE_SECRET/MERCADO_PAGO_WEBHOOK_SECRET",
      names: ["MERCADO_PAGO_WEBHOOK_SIGNATURE_SECRET", "MERCADO_PAGO_WEBHOOK_SECRET"],
    },
  ];

  for (const requirement of requiredSecretGroups) {
    if (!hasAnyEnvValue(requirement.names)) {
      pushFinding(
        "high",
        `Secret obrigatorio de producao ausente: ${requirement.label}.`,
      );
    }
  }

  const cardCheckoutEnabled =
    readEnvValue("FLOWDESK_ENABLE_CARD_CHECKOUTS") === "1" ||
    readEnvValue("NEXT_PUBLIC_FLOWDESK_ENABLE_CARD_CHECKOUTS") === "1";

  if (cardCheckoutEnabled) {
    const cardCheckoutRequirements = [
      {
        label:
          "NEXT_PUBLIC_MERCADO_PAGO_CARD_PUBLIC_KEY/NEXT_PUBLIC_MERCADO_PAGO_CARD_PRODUCTION_PUBLIC_KEY/NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY",
        names: [
          "NEXT_PUBLIC_MERCADO_PAGO_CARD_PUBLIC_KEY",
          "NEXT_PUBLIC_MERCADO_PAGO_CARD_PRODUCTION_PUBLIC_KEY",
          "NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY",
        ],
      },
      {
        label:
          "MERCADO_PAGO_CARD_ACCESS_TOKEN/MERCADO_PAGO_CARD_PRODUCTION_ACCESS_TOKEN/MERCADO_PAGO_ACCESS_TOKEN",
        names: [
          "MERCADO_PAGO_CARD_ACCESS_TOKEN",
          "MERCADO_PAGO_CARD_PRODUCTION_ACCESS_TOKEN",
          "MERCADO_PAGO_ACCESS_TOKEN",
        ],
      },
    ];

    for (const requirement of cardCheckoutRequirements) {
      if (!hasAnyEnvValue(requirement.names)) {
        pushFinding(
          "high",
          `Secret obrigatorio de producao ausente para cartao: ${requirement.label}.`,
        );
      }
    }
  }
}

async function runDastCheck() {
  const targetUrl = readEnvValue("FLOWSECURE_DAST_URL");
  if (!targetUrl) {
    return;
  }

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "manual",
    });
    const csp = response.headers.get("content-security-policy");
    const hsts = response.headers.get("strict-transport-security");
    const frame = response.headers.get("x-frame-options");

    if (!csp) {
      pushFinding("high", "DAST: Content-Security-Policy ausente.", targetUrl);
    }

    if (!hsts && targetUrl.startsWith("https://")) {
      pushFinding("high", "DAST: Strict-Transport-Security ausente.", targetUrl);
    }

    if (!frame) {
      pushFinding("medium", "DAST: X-Frame-Options ausente.", targetUrl);
    }
  } catch (error) {
    pushFinding(
      "medium",
      `DAST: falha ao consultar ${targetUrl}: ${
        error instanceof Error ? error.message : "unknown_error"
      }`,
      targetUrl,
    );
  }
}

function printSummary() {
  const severityOrder = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  findings.sort(
    (left, right) => severityOrder[left.severity] - severityOrder[right.severity],
  );

  if (!findings.length) {
    console.log("FlowSecure Checkup: OK");
    return;
  }

  console.log("FlowSecure Checkup: findings");
  for (const finding of findings) {
    const location = finding.file ? ` [${path.relative(rootDir, finding.file)}]` : "";
    console.log(`- ${finding.severity.toUpperCase()}: ${finding.message}${location}`);
  }
}

async function main() {
  primeEnvCache();
  const files = readProjectFiles();
  scanForDangerousPatterns(files);
  scanSensitiveRoutesForRawJson(files);
  scanSecurityFallbacks();
  scanProductionSecrets();
  await runDastCheck();
  printSummary();

  if (findings.some((finding) => finding.severity === "critical" || finding.severity === "high")) {
    process.exitCode = 1;
  }
}

await main();
