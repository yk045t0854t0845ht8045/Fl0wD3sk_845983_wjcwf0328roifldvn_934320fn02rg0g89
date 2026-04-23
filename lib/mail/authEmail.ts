import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { lookup, resolveTxt } from "node:dns/promises";

type AuthSmtpDkimConfig = {
  domainName: string;
  keySelector: string;
  privateKey: string;
};

type AuthSmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  fromEmail: string;
  fromName: string;
  envelopeFrom: string;
  replyTo: string | null;
  dkim: AuthSmtpDkimConfig | null;
};

let cachedTransporter: nodemailer.Transporter | null = null;
let cachedTransporterKey: string | null = null;
const resolvedSmtpHosts = new Set<string>();
const checkedDeliverabilityDomains = new Set<string>();

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderOtpCodeField(code: string) {
  const normalizedCode = escapeHtml(code.trim().toUpperCase());
  const compact = normalizedCode.length > 4;
  const fontSize = compact ? 26 : 30;
  const letterSpacing = compact ? "0.24em" : "0.32em";

  return `
    <div
      style="
        width:100%;
        max-width:320px;
        margin:0 auto;
        padding:18px 20px;
        border:1px solid #D7E0EB;
        border-radius:20px;
        background-color:#F8FAFC;
        color:#0F172A;
        font-family:'SFMono-Regular','Roboto Mono','Menlo','Consolas','Liberation Mono',monospace;
        font-size:${fontSize}px;
        line-height:1.2;
        font-weight:700;
        letter-spacing:${letterSpacing};
        text-align:center;
        white-space:nowrap;
        user-select:all;
        -webkit-user-select:all;
        box-sizing:border-box;
      "
    >
      ${normalizedCode}
    </div>
  `;
}

function maskEmailAddress(email: string) {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf("@");

  if (atIndex <= 0) {
    return trimmed;
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);

  if (!domainPart) {
    return trimmed;
  }

  if (localPart.length <= 2) {
    return `${localPart[0] || "*"}***@${domainPart}`;
  }

  return `${localPart[0]}${"*".repeat(Math.max(2, localPart.length - 2))}${localPart.at(-1) || ""}@${domainPart}`;
}

function extractEmailDomain(email: string | null | undefined) {
  if (!email) {
    return "";
  }

  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : "";
}

function normalizeMultilineEnvValue(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

function resolveDkimConfigOrThrow() {
  const domainName = process.env.AUTH_SMTP_DKIM_DOMAIN?.trim() || "";
  const keySelector = process.env.AUTH_SMTP_DKIM_SELECTOR?.trim() || "";
  const privateKeyRaw = process.env.AUTH_SMTP_DKIM_PRIVATE_KEY?.trim() || "";

  if (!domainName && !keySelector && !privateKeyRaw) {
    return null;
  }

  const privateKey = normalizeMultilineEnvValue(privateKeyRaw);

  if (!domainName || !keySelector || !privateKey) {
    throw new Error(
      "Para assinar os emails com DKIM, defina AUTH_SMTP_DKIM_DOMAIN, AUTH_SMTP_DKIM_SELECTOR e AUTH_SMTP_DKIM_PRIVATE_KEY.",
    );
  }

  return {
    domainName,
    keySelector,
    privateKey,
  };
}

function formatAuthRequestTimestamp(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.AUTH_EMAIL_TIMEZONE?.trim() || "America/Sao_Paulo",
  }).format(date);
}

function buildAuthMessageId(domain: string) {
  const safeDomain = domain || "flwdesk.local";
  return `<auth-login-${Date.now()}.${crypto.randomBytes(8).toString("hex")}@${safeDomain}>`;
}

async function warnAboutRecommendedDnsRecords(fromEmail: string) {
  const domain = extractEmailDomain(fromEmail);
  if (!domain || checkedDeliverabilityDomains.has(domain)) {
    return;
  }

  checkedDeliverabilityDomains.add(domain);

  const spfRecords = await resolveTxt(domain).catch(() => []);
  const spfValues = spfRecords.flat().map((record) => record.trim().toLowerCase());

  if (!spfValues.some((record) => record.startsWith("v=spf1"))) {
    console.warn(
      `[auth-email] SPF nao encontrado para ${domain}. Configure um registro TXT SPF para reduzir risco de spam.`,
    );
  }

  const dmarcRecords = await resolveTxt(`_dmarc.${domain}`).catch(() => []);
  const dmarcValues = dmarcRecords.flat().map((record) => record.trim().toLowerCase());

  if (!dmarcValues.some((record) => record.startsWith("v=dmarc1"))) {
    console.warn(
      `[auth-email] DMARC nao encontrado para ${domain}. Configure _dmarc.${domain} para melhorar alinhamento e reputacao.`,
    );
  }
}

function buildLoginOtpEmailHtml(input: {
  code: string;
  expiresLabel: string;
  maskedRecipient: string;
  requestedAtLabel: string;
}) {
  const safeCode = escapeHtml(input.code.trim().toUpperCase());
  const safeExpiresLabel = escapeHtml(input.expiresLabel);
  const safeMaskedRecipient = escapeHtml(input.maskedRecipient);
  const safeRequestedAtLabel = escapeHtml(input.requestedAtLabel);
  const codeFieldMarkup = renderOtpCodeField(input.code);

  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <title>Flowdesk | Codigo de verificacao</title>
      </head>
      <body style="margin:0;padding:0;background-color:#EEF3F8;">
        <div
          style="
            display:none;
            max-height:0;
            max-width:0;
            opacity:0;
            overflow:hidden;
            mso-hide:all;
            font-size:1px;
            line-height:1px;
            color:#EEF3F8;
          "
        >
          Seu codigo de verificacao Flowdesk e ${safeCode}. Ele expira em ${safeExpiresLabel}.
        </div>
        <table
          role="presentation"
          cellpadding="0"
          cellspacing="0"
          border="0"
          width="100%"
          style="width:100%;border-collapse:collapse;background-color:#EEF3F8;"
        >
          <tr>
            <td align="center" style="padding:32px 16px;">
              <table
                role="presentation"
                cellpadding="0"
                cellspacing="0"
                border="0"
                width="100%"
                style="width:100%;max-width:640px;border-collapse:separate;"
              >
                <tr>
                  <td style="padding:0 8px 16px 8px;">
                    <table
                      role="presentation"
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      width="100%"
                      style="width:100%;border-collapse:collapse;"
                    >
                      <tr>
                        <td
                          style="
                            font-family:Arial,Helvetica,sans-serif;
                            font-size:14px;
                            line-height:20px;
                            font-weight:700;
                            letter-spacing:0.22em;
                            text-transform:uppercase;
                            color:#111827;
                          "
                        >
                          Flowdesk
                        </td>
                        <td
                          align="right"
                          style="
                            font-family:Arial,Helvetica,sans-serif;
                            font-size:12px;
                            line-height:18px;
                            color:#5B6472;
                          "
                        >
                          Acesso protegido
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td
                    style="
                      background-color:#FFFFFF;
                      border:1px solid #D8E1EC;
                      border-radius:28px;
                      overflow:hidden;
                      box-shadow:0 20px 60px rgba(15,23,42,0.08);
                    "
                  >
                    <table
                      role="presentation"
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      width="100%"
                      style="width:100%;border-collapse:collapse;"
                    >
                      <tr>
                        <td style="padding:36px 40px 14px 40px;">
                          <h1
                            style="
                              margin:0;
                              font-family:Arial,Helvetica,sans-serif;
                              font-size:34px;
                              line-height:1.12;
                              font-weight:700;
                              letter-spacing:-0.03em;
                              color:#0F172A;
                            "
                          >
                            Confirme esta tentativa de acesso
                          </h1>
                          <p
                            style="
                              margin:14px 0 0 0;
                              font-family:Arial,Helvetica,sans-serif;
                              font-size:16px;
                              line-height:1.75;
                              color:#475569;
                            "
                          >
                            Use o codigo temporario abaixo para concluir a entrada no painel com seguranca.
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:6px 24px 0 24px;">
                          <table
                            role="presentation"
                            cellpadding="0"
                            cellspacing="0"
                            border="0"
                            align="center"
                            style="width:100%;margin:0 auto;border-collapse:separate;"
                          >
                            <tr>
                              <td align="center">
                                ${codeFieldMarkup}
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:22px 40px 0 40px;">
                          <table
                            role="presentation"
                            cellpadding="0"
                            cellspacing="0"
                            border="0"
                            width="100%"
                            style="
                              width:100%;
                              border-collapse:separate;
                              border:1px solid #E2E8F0;
                              border-radius:20px;
                              background-color:#F8FAFC;
                            "
                          >
                            <tr>
                              <td style="padding:16px 18px;">
                                <div
                                  style="
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:12px;
                                    line-height:16px;
                                    letter-spacing:0.08em;
                                    text-transform:uppercase;
                                    color:#64748B;
                                  "
                                >
                                  Validade
                                </div>
                                <div
                                  style="
                                    margin-top:6px;
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:15px;
                                    line-height:22px;
                                    font-weight:700;
                                    color:#0F172A;
                                  "
                                >
                                  ${safeExpiresLabel}
                                </div>
                              </td>
                              <td align="right" style="padding:16px 18px;">
                                <div
                                  style="
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:12px;
                                    line-height:16px;
                                    letter-spacing:0.08em;
                                    text-transform:uppercase;
                                    color:#64748B;
                                  "
                                >
                                  Uso unico
                                </div>
                                <div
                                  style="
                                    margin-top:6px;
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:15px;
                                    line-height:22px;
                                    font-weight:700;
                                    color:#0F172A;
                                  "
                                >
                                  Somente nesta tentativa
                                </div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:16px 40px 0 40px;">
                          <table
                            role="presentation"
                            cellpadding="0"
                            cellspacing="0"
                            border="0"
                            width="100%"
                            style="
                              width:100%;
                              border-collapse:separate;
                              border:1px solid #E2E8F0;
                              border-radius:20px;
                              background-color:#FFFFFF;
                            "
                          >
                            <tr>
                              <td style="padding:16px 18px;border-bottom:1px solid #EDF2F7;">
                                <div
                                  style="
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:12px;
                                    line-height:16px;
                                    letter-spacing:0.08em;
                                    text-transform:uppercase;
                                    color:#64748B;
                                  "
                                >
                                  Conta
                                </div>
                                <div
                                  style="
                                    margin-top:6px;
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:15px;
                                    line-height:22px;
                                    font-weight:700;
                                    color:#0F172A;
                                  "
                                >
                                  ${safeMaskedRecipient}
                                </div>
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:16px 18px;">
                                <div
                                  style="
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:12px;
                                    line-height:16px;
                                    letter-spacing:0.08em;
                                    text-transform:uppercase;
                                    color:#64748B;
                                  "
                                >
                                  Solicitado em
                                </div>
                                <div
                                  style="
                                    margin-top:6px;
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:15px;
                                    line-height:22px;
                                    font-weight:700;
                                    color:#0F172A;
                                  "
                                >
                                  ${safeRequestedAtLabel}
                                </div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:20px 40px 0 40px;">
                          <table
                            role="presentation"
                            cellpadding="0"
                            cellspacing="0"
                            border="0"
                            width="100%"
                            style="
                              width:100%;
                              border-collapse:separate;
                              background-color:#F9FBFF;
                              border:1px solid #E4EAF3;
                              border-radius:18px;
                            "
                          >
                            <tr>
                              <td style="padding:18px 20px;">
                                <div
                                  style="
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:14px;
                                    line-height:20px;
                                    font-weight:700;
                                    color:#0F172A;
                                  "
                                >
                                  Dica de seguranca
                                </div>
                                <p
                                  style="
                                    margin:8px 0 0 0;
                                    font-family:Arial,Helvetica,sans-serif;
                                    font-size:14px;
                                    line-height:1.7;
                                    color:#475569;
                                  "
                                >
                                  A Flowdesk nunca solicita este codigo por chat, telefone ou DM. Se voce nao iniciou este acesso, ignore esta mensagem.
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:24px 40px 34px 40px;">
                          <p
                            style="
                              margin:0;
                              font-family:Arial,Helvetica,sans-serif;
                              font-size:13px;
                              line-height:1.8;
                              color:#64748B;
                            "
                          >
                            Este email foi enviado automaticamente para confirmar um acesso seguro ao seu painel.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td
                    align="center"
                    style="
                      padding:16px 20px 0 20px;
                      font-family:Arial,Helvetica,sans-serif;
                      font-size:12px;
                      line-height:1.7;
                      color:#6B7280;
                    "
                  >
                    Flowdesk Security
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function isValidEmailAddress(value: string | null | undefined) {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function sanitizeReplyToAddress(value: string | null) {
  if (!value) return null;
  return isValidEmailAddress(value) ? value.trim() : null;
}

async function ensureSmtpHostResolvable(host: string) {
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) {
    throw new Error(
      "AUTH_SMTP_HOST esta vazio. Configure o host SMTP real do seu provedor de email.",
    );
  }

  if (resolvedSmtpHosts.has(normalizedHost)) {
    return;
  }

  await lookup(normalizedHost);
  resolvedSmtpHosts.add(normalizedHost);
}

function normalizeSmtpRuntimeError(
  error: unknown,
  config: Pick<AuthSmtpConfig, "host" | "port">,
) {
  const errorCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const message = error instanceof Error ? error.message : String(error || "");
  const normalizedMessage = message.toLowerCase();

  if (errorCode === "ENOTFOUND" || normalizedMessage.includes("enotfound")) {
    return new Error(
      `O host SMTP configurado em AUTH_SMTP_HOST (${config.host}) nao existe ou nao resolve no DNS. Use o host SMTP real do seu provedor de email.`,
    );
  }

  if (errorCode === "ECONNREFUSED") {
    return new Error(
      `A conexao SMTP foi recusada em ${config.host}:${config.port}. Revise AUTH_SMTP_HOST, AUTH_SMTP_PORT e AUTH_SMTP_SECURE.`,
    );
  }

  if (
    errorCode === "EAUTH" ||
    normalizedMessage.includes("invalid login") ||
    normalizedMessage.includes("authentication")
  ) {
    return new Error(
      "A autenticacao SMTP falhou. Revise AUTH_SMTP_USER e AUTH_SMTP_PASS.",
    );
  }

  return error instanceof Error
    ? error
    : new Error("Nao foi possivel enviar o email de verificacao.");
}

function resolveSmtpConfigOrThrow(): AuthSmtpConfig {
  const host = process.env.AUTH_SMTP_HOST?.trim() || "";
  const port = Number(process.env.AUTH_SMTP_PORT || "587");
  const secure =
    String(process.env.AUTH_SMTP_SECURE || "false").trim().toLowerCase() === "true";
  const user = process.env.AUTH_SMTP_USER?.trim() || null;
  const pass = process.env.AUTH_SMTP_PASS?.trim() || null;
  const fromEmail =
    process.env.AUTH_SMTP_FROM_EMAIL?.trim() ||
    process.env.AUTH_SMTP_USER?.trim() ||
    "";
  const fromName = process.env.AUTH_SMTP_FROM_NAME?.trim() || "Flowdesk";
  const envelopeFrom =
    process.env.AUTH_SMTP_ENVELOPE_FROM?.trim() ||
    process.env.AUTH_SMTP_FROM_EMAIL?.trim() ||
    process.env.AUTH_SMTP_USER?.trim() ||
    "";
  const replyTo = sanitizeReplyToAddress(process.env.AUTH_SMTP_REPLY_TO?.trim() || null);
  const dkim = resolveDkimConfigOrThrow();

  if (!host || !Number.isFinite(port) || port <= 0 || !fromEmail) {
    throw new Error(
      "Configure AUTH_SMTP_HOST, AUTH_SMTP_PORT e AUTH_SMTP_FROM_EMAIL para enviar o OTP por email.",
    );
  }

  if (!isValidEmailAddress(fromEmail)) {
    throw new Error(
      "AUTH_SMTP_FROM_EMAIL precisa ser um email valido para enviar o OTP.",
    );
  }

  if (!isValidEmailAddress(envelopeFrom)) {
    throw new Error(
      "AUTH_SMTP_ENVELOPE_FROM precisa ser um email valido para alinhar o retorno SMTP.",
    );
  }

  return {
    host,
    port,
    secure,
    user,
    pass,
    fromEmail,
    fromName,
    envelopeFrom,
    replyTo,
    dkim,
  };
}

function getTransporter() {
  const config = resolveSmtpConfigOrThrow();
  const cacheKey = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    fromEmail: config.fromEmail,
    envelopeFrom: config.envelopeFrom,
    dkimDomain: config.dkim?.domainName || "",
    dkimSelector: config.dkim?.keySelector || "",
    dkimPrivateKey: config.dkim?.privateKey || "",
  });

  if (cachedTransporter && cachedTransporterKey === cacheKey) {
    return {
      transporter: cachedTransporter,
      config,
    };
  }

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth:
      config.user && config.pass
        ? {
            user: config.user,
            pass: config.pass,
          }
        : undefined,
    dkim: config.dkim || undefined,
  });
  cachedTransporterKey = cacheKey;

  return {
    transporter: cachedTransporter,
    config,
  };
}

export async function sendLoginOtpEmail(input: {
  toEmail: string;
  code: string;
  expiresInMinutes: number;
}) {
  const { transporter, config } = getTransporter();
  await ensureSmtpHostResolvable(config.host);
  await warnAboutRecommendedDnsRecords(config.fromEmail);
  const from = config.fromName
    ? `"${config.fromName.replace(/"/g, "")}" <${config.fromEmail}>`
    : config.fromEmail;
  const expiresLabel = `${Math.max(1, input.expiresInMinutes)} minuto(s)`;
  const sentAt = new Date();
  const maskedRecipient = maskEmailAddress(input.toEmail);
  const requestedAtLabel = formatAuthRequestTimestamp(sentAt);
  const messageId = buildAuthMessageId(
    extractEmailDomain(config.envelopeFrom) || extractEmailDomain(config.fromEmail),
  );

  try {
    await transporter.sendMail({
      from,
      to: input.toEmail,
      replyTo: config.replyTo || undefined,
      envelope: {
        from: config.envelopeFrom,
        to: input.toEmail,
      },
      messageId,
      date: sentAt,
      subject: "Flowdesk | Codigo de acesso",
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
        "X-Flowdesk-Email-Type": "auth-login-otp",
        "Feedback-ID": "flowdesk:auth:login-otp",
      },
      text: [
        "Flowdesk Security",
        "",
        "Recebemos uma solicitacao de acesso ao painel.",
        "",
        `Codigo temporario: ${input.code}`,
        `Conta: ${maskedRecipient}`,
        `Solicitado em: ${requestedAtLabel}`,
        `Validade: ${expiresLabel}`,
        "",
        "Nunca compartilhe este codigo com terceiros.",
        "Se voce nao iniciou esta solicitacao, ignore este email.",
      ].join("\n"),
      html: buildLoginOtpEmailHtml({
        code: input.code,
        expiresLabel,
        maskedRecipient,
        requestedAtLabel,
      }),
    });
  } catch (error) {
    throw normalizeSmtpRuntimeError(error, config);
  }
}

export type FlowdeskTransactionalEmailSection = {
  label: string;
  value: string | number | null | undefined;
};

export type FlowdeskTransactionalEmailAction = {
  label: string;
  href: string;
};

function renderTransactionalSections(
  sections: FlowdeskTransactionalEmailSection[] | null | undefined,
) {
  const visibleSections = (sections || []).filter(
    (section) => section.value !== null && section.value !== undefined && String(section.value).trim(),
  );

  if (!visibleSections.length) return "";

  return `
    <table
      role="presentation"
      cellpadding="0"
      cellspacing="0"
      border="0"
      width="100%"
      style="width:100%;border-collapse:separate;border:1px solid #E2E8F0;border-radius:20px;background-color:#F8FAFC;margin-top:22px;"
    >
      ${visibleSections
        .map(
          (section, index) => `
            <tr>
              <td style="padding:15px 18px;${index > 0 ? "border-top:1px solid #EDF2F7;" : ""}">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:#64748B;">
                  ${escapeHtml(section.label)}
                </div>
                <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;font-weight:700;color:#0F172A;">
                  ${escapeHtml(String(section.value))}
                </div>
              </td>
            </tr>
          `,
        )
        .join("")}
    </table>
  `;
}

function renderTransactionalAction(
  action: FlowdeskTransactionalEmailAction | null | undefined,
) {
  if (!action?.href || !action.label) return "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
      <tr>
        <td
          bgcolor="#0F172A"
          style="border-radius:16px;background-color:#0F172A;"
        >
          <a
            href="${escapeHtml(action.href)}"
            target="_blank"
            rel="noopener noreferrer"
            style="display:inline-block;padding:14px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:16px;"
          >
            ${escapeHtml(action.label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

function buildTransactionalEmailHtml(input: {
  preheader: string;
  badgeLabel?: string | null;
  title: string;
  intro: string;
  sections?: FlowdeskTransactionalEmailSection[];
  action?: FlowdeskTransactionalEmailAction | null;
  footer?: string | null;
}) {
  const safePreheader = escapeHtml(input.preheader);
  const safeBadgeLabel = escapeHtml(input.badgeLabel || "Flowdesk");
  const safeTitle = escapeHtml(input.title);
  const safeIntro = escapeHtml(input.intro);
  const safeFooter = escapeHtml(
    input.footer ||
      "Este email foi enviado automaticamente para manter sua conta Flowdesk informada.",
  );

  return `
    <!doctype html>
    <html lang="pt-BR">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <title>Flowdesk</title>
      </head>
      <body style="margin:0;padding:0;background-color:#EEF3F8;">
        <div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#EEF3F8;">
          ${safePreheader}
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background-color:#EEF3F8;">
          <tr>
            <td align="center" style="padding:32px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:640px;border-collapse:separate;">
                <tr>
                  <td style="padding:0 8px 16px 8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
                      <tr>
                        <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#111827;">
                          Flowdesk
                        </td>
                        <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#5B6472;">
                          ${safeBadgeLabel}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background-color:#FFFFFF;border:1px solid #D8E1EC;border-radius:28px;overflow:hidden;box-shadow:0 20px 60px rgba(15,23,42,0.08);">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
                      <tr>
                        <td style="padding:36px 40px 34px 40px;">
                          <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:32px;line-height:1.15;font-weight:700;color:#0F172A;">
                            ${safeTitle}
                          </h1>
                          <p style="margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.75;color:#475569;">
                            ${safeIntro}
                          </p>
                          ${renderTransactionalSections(input.sections)}
                          ${renderTransactionalAction(input.action)}
                          <p style="margin:24px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.8;color:#64748B;">
                            ${safeFooter}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:16px 20px 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#6B7280;">
                    Flowdesk
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export async function sendFlowdeskTransactionalEmail(input: {
  toEmail: string;
  subject: string;
  preheader: string;
  badgeLabel?: string | null;
  title: string;
  intro: string;
  sections?: FlowdeskTransactionalEmailSection[];
  action?: FlowdeskTransactionalEmailAction | null;
  footer?: string | null;
  type: string;
}) {
  const { transporter, config } = getTransporter();
  await ensureSmtpHostResolvable(config.host);
  await warnAboutRecommendedDnsRecords(config.fromEmail);

  const from = config.fromName
    ? `"${config.fromName.replace(/"/g, "")}" <${config.fromEmail}>`
    : config.fromEmail;
  const sentAt = new Date();
  const messageId = buildAuthMessageId(
    extractEmailDomain(config.envelopeFrom) || extractEmailDomain(config.fromEmail),
  );
  const visibleSections = (input.sections || []).filter(
    (section) => section.value !== null && section.value !== undefined && String(section.value).trim(),
  );
  const textLines = [
    "Flowdesk",
    "",
    input.title,
    "",
    input.intro,
    "",
    ...visibleSections.flatMap((section) => [
      `${section.label}: ${String(section.value)}`,
    ]),
    ...(input.action?.href
      ? ["", `${input.action.label}: ${input.action.href}`]
      : []),
    "",
    input.footer ||
      "Este email foi enviado automaticamente para manter sua conta Flowdesk informada.",
  ];

  try {
    await transporter.sendMail({
      from,
      to: input.toEmail,
      replyTo: config.replyTo || undefined,
      envelope: {
        from: config.envelopeFrom,
        to: input.toEmail,
      },
      messageId,
      date: sentAt,
      subject: input.subject,
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
        "X-Flowdesk-Email-Type": input.type,
        "Feedback-ID": `flowdesk:${input.type.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`,
      },
      text: textLines.join("\n"),
      html: buildTransactionalEmailHtml(input),
    });
  } catch (error) {
    throw normalizeSmtpRuntimeError(error, config);
  }
}
