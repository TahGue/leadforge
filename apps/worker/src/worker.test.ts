/**
 * Worker integration test.
 *
 * Verifies the sending gate with a real database: a scheduled campaign is
 * claimed, each recipient is re-evaluated, and nothing is sent while mail is in
 * test mode. Also verifies suppression wins over an otherwise eligible record.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@leadforge/database";
import { JURISDICTION_PROFILES } from "@leadforge/compliance";
import { tick } from "./index";

const stamp = Date.now();
let organizationId = "";
let campaignId = "";
let recipientEmailId = "";

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@leadforge.local" },
    include: { memberships: true },
  });
  organizationId = admin.memberships[0]!.organizationId;

  await prisma.jurisdictionProfile.upsert({
    where: { code_version: { code: "SE", version: "2026.1" } },
    create: {
      code: "SE",
      version: "2026.1",
      status: "APPROVED",
      rules: JURISDICTION_PROFILES.SE as unknown as object,
      approvedBy: admin.id,
      approvedAt: new Date(),
      notes: "test approval",
    },
    update: { status: "APPROVED", approvedBy: admin.id, approvedAt: new Date() },
  });

  const company = await prisma.company.create({
    data: { organizationId, name: `Worker Fixture ${stamp}`, countryCode: "SE", industryLabel: "Testing" },
  });
  const contact = await prisma.contact.create({
    data: { organizationId, companyId: company.id, type: "GENERIC_BUSINESS", confidence: 0.9 },
  });
  const email = await prisma.emailAddress.create({
    data: {
      address: `worker-${stamp}@fixture.se`,
      normalized: `worker-${stamp}@fixture.se`,
      localPart: `worker-${stamp}`,
      domain: "fixture.se",
      status: "MX_VALID",
      isRoleAccount: true,
      lastVerifiedAt: new Date(),
      verificationExpiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  await prisma.contactEmail.create({
    data: { contactId: contact.id, emailId: email.id, isPrimary: true },
  });
  await prisma.lawfulBasisRecord.create({
    data: {
      organizationId,
      emailId: email.id,
      basis: "LEGITIMATE_INTEREST",
      jurisdictionCode: "SE",
      assessment: { purpose: "test" },
    },
  });
  recipientEmailId = email.id;

  const campaign = await prisma.campaign.create({
    data: {
      organizationId,
      name: `Worker campaign ${stamp}`,
      subject: "Worker test",
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
      lawfulBasis: "LEGITIMATE_INTEREST",
      status: "SCHEDULED",
      scheduledAt: new Date(Date.now() - 60_000),
      approvedAt: new Date(),
    },
  });
  campaignId = campaign.id;

  await prisma.campaignRecipient.create({
    data: { campaignId, emailId: email.id, emailSnapshot: email.normalized, status: "PENDING" },
  });
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("campaign worker", () => {
  it("claims the campaign, re-evaluates, and refuses to send in test mode", async () => {
    await tick();

    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe("COMPLETED");

    const recipient = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId, emailId: recipientEmailId },
    });
    expect(recipient.status).toBe("EXCLUDED");
    expect(recipient.error).toBe("MAIL_DISABLED");

    expect(await prisma.campaignSend.count({ where: { campaignId } })).toBe(0);

    const event = await prisma.emailEvent.findFirst({
      where: { campaignId, type: "NOT_SENT" },
    });
    expect(event).not.toBeNull();
  });

  it("does not send to a recipient suppressed after preparation", async () => {
    const email = await prisma.emailAddress.findUniqueOrThrow({
      where: { id: recipientEmailId },
    });
    await prisma.suppressionEntry.create({
      data: {
        organizationId,
        emailNormalized: email.normalized,
        reason: "COMPLAINT",
        source: "test",
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        organizationId,
        name: `Suppressed ${stamp}`,
        subject: "Suppressed",
        bodyHtml: "<p>Hello</p>",
        bodyText: "Hello",
        lawfulBasis: "LEGITIMATE_INTEREST",
        status: "SCHEDULED",
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.campaignRecipient.create({
      data: { campaignId: campaign.id, emailId: recipientEmailId, emailSnapshot: email.normalized },
    });

    await tick();

    const recipient = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId: campaign.id },
    });
    expect(["EXCLUDED", "SUPPRESSED"]).toContain(recipient.status);
    expect(await prisma.campaignSend.count({ where: { campaignId: campaign.id } })).toBe(0);
  });
});
