import { z } from "zod";
import { suggestFromKeyword } from "@leadforge/pipeline";
import { parseBody } from "@leadforge/shared";
import { json, withAuth } from "@/lib/api";

export const dynamic = "force-dynamic";

const body = z.object({ query: z.string().trim().min(2).max(120) });

/**
 * Detect industries from a free-text keyword and suggest include/exclude
 * keywords for a discovery project. Read-only: nothing is stored until the
 * user applies the suggestion in the project wizard.
 */
export const POST = withAuth(async (request) => {
  const { query } = await parseBody(request, body);
  return json({ data: await suggestFromKeyword(query) });
}, "ANALYST");
