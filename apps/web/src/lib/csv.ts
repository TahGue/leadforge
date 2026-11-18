/** Minimal RFC4180-ish CSV parser: quotes, escaped quotes, CRLF, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }

  return rows;
}

export interface CompanyCsvRow {
  name: string;
  domain: string;
  countryCode?: string;
  industry?: string;
  website?: string;
}

const COLUMN_ALIASES: Record<keyof CompanyCsvRow, string[]> = {
  name: ["name", "company", "company_name", "organisation", "organization"],
  domain: ["domain", "website", "url", "site"],
  countryCode: ["country_code", "country", "cc"],
  industry: ["industry", "sector", "category"],
  website: ["website", "url", "site"],
};

function pick(header: string[], row: string[], keys: string[]): string | undefined {
  for (const key of keys) {
    const index = header.indexOf(key);
    if (index >= 0 && row[index]) return row[index].trim();
  }
  return undefined;
}

export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    ?.split("?")[0]
    ?.replace(/\.$/, "") ?? "";
}

export function parseCompanyCsv(csv: string): {
  rows: CompanyCsvRow[];
  errors: { row: number; message: string }[];
} {
  const table = parseCsv(csv);
  if (table.length < 2) return { rows: [], errors: [{ row: 0, message: "CSV has no data rows" }] };

  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows: CompanyCsvRow[] = [];
  const errors: { row: number; message: string }[] = [];

  for (let i = 1; i < table.length; i += 1) {
    const raw = table[i] ?? [];
    const domain = normalizeDomain(pick(header, raw, COLUMN_ALIASES.domain) ?? "");
    const name = pick(header, raw, COLUMN_ALIASES.name) ?? domain.split(".")[0] ?? "";

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      errors.push({ row: i + 1, message: `Invalid domain: "${domain}"` });
      continue;
    }
    if (!name) {
      errors.push({ row: i + 1, message: "Missing company name" });
      continue;
    }

    rows.push({
      name,
      domain,
      countryCode: pick(header, raw, COLUMN_ALIASES.countryCode)?.toUpperCase().slice(0, 2),
      industry: pick(header, raw, COLUMN_ALIASES.industry),
      website: `https://${domain}`,
    });
  }

  return { rows, errors };
}
