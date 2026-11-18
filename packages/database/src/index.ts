import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export * from "@prisma/client";
export { Prisma };

/**
 * Every org-scoped query must go through this helper. It centralises the
 * tenant filter so a missing `where` clause is a type error rather than a
 * data leak.
 */
export function orgWhere(organizationId: string) {
  return { organizationId } as const;
}

export async function withOrg<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // RLS hook point: when ENABLE_RLS is on, policies read this setting.
    if (process.env.ENABLE_RLS === "true") {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.organization_id', $1, true)`,
        organizationId,
      );
    }
    return fn(tx);
  });
}

export * from "./evaluate";

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
