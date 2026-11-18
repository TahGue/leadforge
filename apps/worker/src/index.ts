/**
 * Campaign worker.
 *
 * Claims due campaigns, re-evaluates every recipient immediately before send,
 * and records a delivery attempt per message. Safe to run more than one
 * instance: recipients are claimed with a status transition, not a read.
 */
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { evaluateForCampaign, prisma, type Prisma } from "@leadforge/database";

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, "../../../.env") });

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 15_000);
const MAIL_ENABLED = process.env.MAIL_ENABLED === "true";
const ALLOWLIST = (process.env.MAIL_TEST_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const UNSUB_KEY = process.env.UNSUBSCRIBE_SIGNING_KEY ?? "";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const FROM = process.env.SMTP_FROM ?? "outreach@localhost";
const FROM_NAME = process.env.SMTP_FROM_NAME ?? "LeadForge";
const POSTAL = process.env.MAIL_POSTAL_ADDRESS ?? "";

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "127.0.0.1",
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT ?? 587) === 465,
  requireTLS: Number(process.env.SMTP_PORT ?? 587) === 587,
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASSWORD
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
});

function unsubscribeUrl(emailNormalized: string, campaignId: string): string {
  const token = createHmac("sha256", UNSUB_KEY)
    .update(`${emailNormalized}:${campaignId}`)
    .digest("base64url");
  const params = new URLSearchParams({ e: emailNormalized, c: campaignId });
  return `${APP_URL}/unsubscribe/${token}?${params.toString()}`;
}

function footer(url: string): string {
  return `<hr /><p style="font-size:12px;color:#666">You received this business email because your role is relevant to ${FROM_NAME}.<br />${FROM_NAME}${POSTAL ? ` - ${POSTAL}` : ""}<br /><a href="${url}">Unsubscribe</a></p>`;
}

async function sendOne(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  campaignId: string;
}) {
  if (!MAIL_ENABLED && !ALLOWLIST.includes(input.to.toLowerCase())) {
    return { sent: false, reason: "MAIL_DISABLED" as const };
  }
  if (MAIL_ENABLED && ALLOWLIST.length > 0 && !ALLOWLIST.includes(input.to.toLowerCase())) {
    return { sent: false, reason: "NOT_ALLOWLISTED" as const };
  }

  const info = await transport.sendMail({
    from: `"${FROM_NAME}" <${FROM}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl(input.to, input.campaignId)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  return { sent: true, messageId: info.messageId, response: info.response };
}

async function processCampaign(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return;

  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    take: 50,
    orderBy: { queuedAt: "asc" },
    include: { email: true },
  });

  for (const recipient of pending) {
    const current = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });
    if (!current || ["PAUSED", "CANCELLED"].includes(current.status)) return;

    // Claim atomically so two workers cannot send the same message.
    const claimed = await prisma.campaignRecipient.updateMany({
      where: { id: recipient.id, status: "PENDING" },
      data: { status: "SENDING" },
    });
    if (claimed.count === 0) continue;

    const evaluation = await evaluateForCampaign(prisma, {
      organizationId: campaign.organizationId,
      emailId: recipient.emailId,
      campaignId,
      senderIdentityConfigured: Boolean(FROM && POSTAL),
      unsubscribeConfigured: Boolean(UNSUB_KEY),
    });

    if (evaluation.outcome !== "ELIGIBLE") {
      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: evaluation.outcome === "SUPPRESSED" ? "SUPPRESSED" : "EXCLUDED",
            error: evaluation.reasons.map((r) => r.code).join(","),
            eligibilityDecisionId: evaluation.decisionId,
          },
        }),
        prisma.emailEvent.create({
          data: {
            organizationId: campaign.organizationId,
            emailId: recipient.emailId,
            campaignId,
            type: "EXCLUDED",
            metadata: {
              reasons: evaluation.reasons as unknown as object[],
              ruleSetVersion: evaluation.ruleSetVersion,
            },
          },
        }),
      ]);
      continue;
    }

    try {
      const url = unsubscribeUrl(recipient.emailSnapshot, campaignId);
      const outcome = await sendOne({
        to: recipient.emailSnapshot,
        subject: campaign.subject,
        html: `${campaign.bodyHtml}${footer(url)}`,
        text: `${campaign.bodyText}\n\nUnsubscribe: ${url}`,
        campaignId,
      });

      const operations: Prisma.PrismaPromise<unknown>[] = [
        prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: outcome.sent
            ? { status: "SENT", sentAt: new Date() }
            : { status: "EXCLUDED", error: outcome.reason },
        }),
        prisma.emailEvent.create({
          data: {
            organizationId: campaign.organizationId,
            emailId: recipient.emailId,
            campaignId,
            type: outcome.sent ? "SENT" : "NOT_SENT",
            providerMessageId: outcome.sent ? outcome.messageId : null,
            metadata: { reason: outcome.sent ? null : outcome.reason },
          },
        }),
      ];

      // Only a real delivery attempt counts as a send. Test-mode refusals are
      // recorded as events so the campaign still reports an honest state.
      if (outcome.sent) {
        operations.push(
          prisma.campaignSend.create({
            data: {
              campaignId,
              recipientId: recipient.id,
              attempt: 1,
              provider: "smtp",
              providerMessageId: outcome.messageId,
              smtpResponse: outcome.response,
            },
          }),
        );
      }

      await prisma.$transaction(operations);
    } catch (error) {
      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "FAILED", error: (error as Error).message.slice(0, 500) },
        }),
        prisma.emailEvent.create({
          data: {
            organizationId: campaign.organizationId,
            emailId: recipient.emailId,
            campaignId,
            type: "SEND_FAILED",
            metadata: { error: (error as Error).message.slice(0, 500) },
          },
        }),
      ]);
    }
  }

  const remaining = await prisma.campaignRecipient.count({
    where: { campaignId, status: { in: ["PENDING", "SENDING"] } },
  });
  if (remaining === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    console.log(`campaign ${campaignId} completed`);
  }
}

async function tick(): Promise<void> {
  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    take: 5,
  });

  for (const campaign of due) {
    const claimed = await prisma.campaign.updateMany({
      where: { id: campaign.id, status: "SCHEDULED" },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    if (claimed.count === 0) continue;
    console.log(`campaign ${campaign.id} started`);
    await processCampaign(campaign.id);
  }
}

async function main(): Promise<void> {
  console.log(
    `leadforge worker starting (mail=${MAIL_ENABLED ? "live" : "test"}, poll=${POLL_MS}ms)`,
  );
  if (process.env.WORKER_ONCE === "true") {
    await tick();
    await prisma.$disconnect();
    return;
  }

  let stopping = false;
  const shutdown = async () => {
    stopping = true;
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      console.error("worker tick failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export { tick, processCampaign };

if (process.env.WORKER_NO_AUTOSTART !== "true") {
  void main();
}
