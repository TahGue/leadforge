import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rows = await prisma.campaign.findMany({
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { id: true, name: true, status: true, scheduledAt: true, approvedAt: true },
});
console.log(rows);
const due = await prisma.campaign.count({
  where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
});
console.log("due now:", due, "now:", new Date().toISOString());
await prisma.$disconnect();
