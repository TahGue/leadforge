/** Typed access to the small set of environment values the app needs. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  sessionSecret: process.env.SESSION_SECRET ?? "",
  unsubscribeKey: process.env.UNSUBSCRIBE_SIGNING_KEY ?? process.env.SESSION_SECRET ?? "",
  mailEnabled: process.env.MAIL_ENABLED === "true",
  mailTestAllowlist: (process.env.MAIL_TEST_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  smtp: {
    host: process.env.SMTP_HOST ?? "127.0.0.1",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.SMTP_FROM ?? "outreach@localhost",
    fromName: process.env.SMTP_FROM_NAME ?? "LeadForge",
  },
  redisUrl: process.env.REDIS_URL ?? "",
  postalAddress: process.env.MAIL_POSTAL_ADDRESS ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // Secure cookies require TLS. Tie this to the public URL, not NODE_ENV, so
  // local production-mode runs and TLS-terminating proxies behave correctly.
  cookieSecure: (process.env.APP_URL ?? "").startsWith("https://"),
  requireEnv: required,
};

export function assertProductionSecrets(): void {
  if (!env.isProduction) return;
  if (env.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
  }
  if (env.mailEnabled && env.unsubscribeKey.length < 32) {
    throw new Error("UNSUBSCRIBE_SIGNING_KEY must be set (32+ chars) when mail is enabled");
  }
}
