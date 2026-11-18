/**
 * Integration tests run against a real PostgreSQL-compatible database.
 * They are skipped when DATABASE_URL is not reachable.
 */
process.env.DATABASE_URL ??=
  "postgresql://leadforge:leadforge_local@127.0.0.1:5432/leadforge?schema=public";
process.env.SESSION_SECRET = "test-session-secret-test-session-secret";
process.env.UNSUBSCRIBE_SIGNING_KEY = "test-unsubscribe-key-test-unsubscribe";
process.env.MAIL_POSTAL_ADDRESS = "LeadForge Test AB, Testgatan 1, 111 22 Stockholm";
process.env.APP_URL = "http://localhost:3000";
process.env.MAIL_ENABLED = "false";
process.env.MAIL_TEST_ALLOWLIST = "";
process.env.SMTP_FROM = "outreach@leadforge.test";
process.env.WORKER_NO_AUTOSTART = "true";
