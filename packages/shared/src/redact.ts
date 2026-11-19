/**
 * Strip credentials from text before it is logged (spec 26: no secret leakage in logs).
 * Covers URL userinfo passwords (database/Redis/SMTP URLs in driver errors),
 * bearer tokens, and the session cookie.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s@/]+@/gi, "$1:***@"],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***"],
  [/\b(lf_session=)[^;\s]+/g, "$1***"],
];

export function redactSecrets(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

/** A loggable, redacted view of an unknown thrown value. */
export function describeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecrets(error.message),
      ...(error.stack ? { stack: redactSecrets(error.stack) } : {}),
    };
  }
  return { name: "NonError", message: redactSecrets(String(error)) };
}
