/**
 * Runs once when the server starts. Fails fast on unsafe production config
 * instead of discovering a missing secret during the first campaign send.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionSecrets } = await import("./lib/env");
  assertProductionSecrets();
}
