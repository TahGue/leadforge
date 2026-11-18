/**
 * Runs once when the server starts.
 *
 * 1. Fail fast on unsafe production configuration instead of discovering a
 *    missing secret during the first campaign send.
 * 2. Keep the database connection warm. Some local Postgres shims (and idle
 *    NAT/firewall paths) drop dormant sockets; a cheap periodic probe prevents
 *    the first request after a quiet period from failing with P1001.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertProductionSecrets } = await import("./lib/env");
  assertProductionSecrets();

  const { prisma } = await import("@leadforge/database");
  const timer = setInterval(() => {
    void prisma.$queryRaw`SELECT 1`.catch(() => undefined);
  }, 30_000);
  // Do not keep the process alive just for the probe.
  timer.unref?.();
}
