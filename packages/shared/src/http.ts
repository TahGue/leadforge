import { z, type ZodTypeAny } from "zod";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function parseBody<S extends ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid request", result.error.flatten());
  }
  return result.data as z.infer<S>;
}

export function parseQuery<S extends ZodTypeAny>(url: URL, schema: S): z.infer<S> {
  const raw = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid query", result.error.flatten());
  }
  return result.data as z.infer<S>;
}

/** Opaque, stable keyset cursor: base64url(JSON). */
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T = Record<string, string>>(cursor: string): T {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Malformed cursor");
  }
}

export function paginationResult<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Record<string, unknown>,
): { data: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
  };
}

/** Escapes user data so spreadsheet apps do not execute it as a formula. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
