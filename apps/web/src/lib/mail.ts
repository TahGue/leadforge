import { createHmac, timingSafeEqual } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@leadforge/database";
import { env } from "./env";

let transporter: Transporter | null = null;

function transport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      requireTLS: env.smtp.port === 587,
      auth:
        env.smtp.user && env.smtp.password
          ? { user: env.smtp.user, pass: env.smtp.password }
          : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });
  }
  return transporter;
}

export function unsubscribeSignature(emailNormalized: string, campaignId: string): string {
  return createHmac("sha256", env.unsubscribeKey)
    .update(`${emailNormalized}:${campaignId}`)
    .digest("base64url");
}

export function verifyUnsubscribeSignature(
  token: string,
  emailNormalized: string,
  campaignId: string,
): boolean {
  const expected = Buffer.from(unsubscribeSignature(emailNormalized, campaignId));
  const provided = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function createUnsubscribeLink(
  emailNormalized: string,
  campaignId: string,
): Promise<string> {
  const token = unsubscribeSignature(emailNormalized, campaignId);
  await prisma.unsubscribeToken.upsert({
    where: { token },
    create: {
      token,
      emailNormalized,
      campaignId,
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
    },
    update: {},
  });
  return `${env.appUrl}/unsubscribe/${token}?e=${encodeURIComponent(emailNormalized)}&c=${encodeURIComponent(campaignId)}`;
}

export function renderFooter(options: { unsubscribeUrl: string }): string {
  const identity = env.smtp.fromName;
  const address = env.postalAddress;
  return [
    `<hr />`,
    `<p style="font-size:12px;color:#666">`,
    `You are receiving this business email because your role is relevant to ${identity}.`,
    `<br />${identity}${address ? ` · ${address}` : ""}`,
    `<br /><a href="${options.unsubscribeUrl}">Unsubscribe</a>`,
    `</p>`,
  ].join("");
}

export interface SendOutcome {
  sent: boolean;
  messageId?: string;
  response?: string;
  reason?: string;
}

/**
 * Sends a single campaign message. Test mode is enforced here, not in callers:
 * with MAIL_ENABLED=false only allowlisted addresses receive anything.
 */
export async function sendCampaignEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  campaignId: string;
}): Promise<SendOutcome> {
  const allowlisted = env.mailTestAllowlist.includes(input.to.toLowerCase());

  if (!env.mailEnabled && !allowlisted) {
    return { sent: false, reason: "MAIL_DISABLED" };
  }
  if (env.mailEnabled && !allowlisted && env.mailTestAllowlist.length > 0) {
    // During warmup only allowlisted recipients receive mail.
    return { sent: false, reason: "NOT_ALLOWLISTED" };
  }

  const info = await transport().sendMail({
    from: `"${env.smtp.fromName}" <${env.smtp.from}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: {
      "List-Unsubscribe": `<${env.appUrl}/unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      "X-LeadForge-Campaign": input.campaignId,
    },
  });

  return { sent: true, messageId: info.messageId, response: info.response };
}
