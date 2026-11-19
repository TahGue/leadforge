"use client";

/**
 * New discovery project wizard (spec 5 and 21): nine steps with a persistent
 * scope summary. Form state lives in React Hook Form; the whole payload is
 * validated with the shared Zod contract before it is saved, and the server
 * validates it again.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import {
  CONTACT_CATEGORIES,
  discoveryProjectInput,
  discoveryProjectSettings,
  registrableDomain,
  type DiscoveryProjectInput,
  type DiscoveryProjectSettings,
} from "@leadforge/shared";
import { api } from "@/lib/client";
import { GeoPicker, type GeoOptions, type LocationValue } from "./geo-picker";
import { IndustryPicker, type IndustryFilterValue, type IndustryNode } from "./industry-picker";
import { KeywordDetector, type KeywordSuggestion } from "./keyword-detector";

export interface WizardSource {
  id: string;
  name: string;
  adapter: string | null;
  sourceType: string;
  policyStatus: string;
  enabled: boolean;
  permitted: boolean;
  licenceName: string | null;
}

interface Preview {
  warnings: string[];
  blockers: string[];
  budget: { maxRequests: number; estimatedCrawlHours: number };
  estimates: { knownCompaniesInScope: number; knownCompaniesWithDomain: number; note: string };
  scope: { geography: string[]; excludedGeography: string[]; industries: string[]; excludedIndustries: string[]; keywords: string[] };
  sources: { name: string; usable: boolean; note: string | null }[];
  requiresApproval: boolean;
  approved: boolean;
}

const STEPS = [
  "Project details",
  "Geography",
  "Industry",
  "Company profile",
  "Contacts",
  "Sources",
  "Quality and exclusions",
  "Review",
  "Run",
] as const;

const EMPLOYEE_RANGES = ["1-9", "10-49", "50-249", "250-999", "1000+"];
const OPERATING = ["ACTIVE", "INACTIVE", "NEWLY_REGISTERED", "UNKNOWN"] as const;
const OWNERSHIP = ["INDEPENDENT", "SUBSIDIARY", "FRANCHISE"] as const;

interface BasicFields {
  name: string;
  description: string;
  geographicMode: DiscoveryProjectInput["geographicMode"];
  maxCompanies: number;
  maxPagesPerCompany: number;
  maxCrawlDepth: number;
  minConfidence: number;
}

function lines(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <span className="block text-xs muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function MultiCheck<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {options.map((option) => (
        <label key={option} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={value.includes(option)}
            onChange={(e) => onChange(e.target.checked ? [...value, option] : value.filter((v) => v !== option))}
          />
          {option.replaceAll("_", " ").toLowerCase()}
        </label>
      ))}
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, step }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className="text-xs">
      <span className="muted">{label}</span>
      <input
        type="number"
        className="input mt-1"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </label>
  );
}

export function ProjectWizard({
  geo,
  industries,
  sources,
  initial,
}: {
  geo: GeoOptions;
  industries: IndustryNode[];
  sources: WizardSource[];
  initial?: { id: string; input: DiscoveryProjectInput; locationLabels: string[] };
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(initial?.id ?? null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const form = useForm<BasicFields>({
    defaultValues: {
      name: initial?.input.name ?? "",
      description: initial?.input.description ?? "",
      geographicMode: initial?.input.geographicMode ?? "COUNTRY",
      maxCompanies: initial?.input.maxCompanies ?? 500,
      maxPagesPerCompany: initial?.input.maxPagesPerCompany ?? 12,
      maxCrawlDepth: initial?.input.maxCrawlDepth ?? 2,
      minConfidence: initial?.input.minConfidence ?? 0.5,
    },
  });
  const basics = form.watch();

  const [locations, setLocations] = useState<LocationValue[]>(
    (initial?.input.locations ?? []).map((l, i) => ({ ...l, label: initial?.locationLabels[i] ?? l.level })),
  );
  const [industryFilters, setIndustryFilters] = useState<IndustryFilterValue[]>(initial?.input.industries ?? []);
  const [includeKeywords, setIncludeKeywords] = useState(
    (initial?.input.keywords ?? []).filter((k) => k.mode === "INCLUDE").map((k) => k.keyword).join("\n"),
  );
  const [excludeKeywords, setExcludeKeywords] = useState(
    (initial?.input.keywords ?? []).filter((k) => k.mode === "EXCLUDE").map((k) => k.keyword).join("\n"),
  );
  const [settings, setSettings] = useState<DiscoveryProjectSettings>(
    initial?.input.settings ?? discoveryProjectSettings.parse({}),
  );
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries((initial?.input.sources ?? []).map((s) => [s.sourceId, s.enabled])),
  );
  const [sourceConfig, setSourceConfig] = useState<Record<string, Record<string, unknown>>>(
    Object.fromEntries((initial?.input.sources ?? []).map((s) => [s.sourceId, s.configuration])),
  );

  const patch = <K extends keyof DiscoveryProjectSettings>(key: K, value: Partial<DiscoveryProjectSettings[K]>) =>
    setSettings((current) => ({ ...current, [key]: { ...(current[key] as object), ...value } }));

  // Merge a keyword suggestion: add its industries as included filters and its keywords to the lists.
  function applySuggestion(suggestion: KeywordSuggestion) {
    setIndustryFilters((current) => {
      const next = [...current];
      for (const industry of suggestion.industries) {
        if (next.some((f) => f.industryId === industry.industryId)) continue;
        next.push({
          industryId: industry.industryId,
          mode: "INCLUDE",
          isPrimary: !next.some((f) => f.isPrimary),
          includeDescendants: true,
        });
      }
      return next;
    });
    const merge = (text: string, add: string[]) => {
      const existing = lines(text);
      const seen = new Set(existing.map((k) => k.toLowerCase()));
      return [...existing, ...add.filter((k) => !seen.has(k.toLowerCase()))].join("\n");
    };
    setIncludeKeywords((text) => merge(text, suggestion.includeKeywords));
    setExcludeKeywords((text) => merge(text, suggestion.excludeKeywords));
  }

  const industryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const sector of industries) {
      map.set(sector.id, sector.name);
      for (const sub of sector.children ?? []) map.set(sub.id, `${sector.name} › ${sub.name}`);
    }
    return map;
  }, [industries]);

  function buildPayload(): DiscoveryProjectInput | null {
    const candidate = {
      name: basics.name,
      description: basics.description || undefined,
      geographicMode: basics.geographicMode,
      maxCompanies: Number(basics.maxCompanies),
      maxPagesPerCompany: Number(basics.maxPagesPerCompany),
      maxCrawlDepth: Number(basics.maxCrawlDepth),
      minConfidence: Number(basics.minConfidence),
      locations: basics.geographicMode === "WORLDWIDE" ? locations.filter((l) => l.mode === "EXCLUDE") : locations,
      industries: industryFilters,
      keywords: [
        ...lines(includeKeywords).map((keyword) => ({ keyword, mode: "INCLUDE" as const, keywordType: "GENERAL" as const })),
        ...lines(excludeKeywords).map((keyword) => ({ keyword, mode: "EXCLUDE" as const, keywordType: "GENERAL" as const })),
      ],
      sources: Object.entries(selected)
        .filter(([, on]) => on)
        .map(([sourceId]) => ({ sourceId, enabled: true, configuration: sourceConfig[sourceId] ?? {} })),
      settings,
    };
    const parsed = discoveryProjectInput.safeParse({
      ...candidate,
      locations: candidate.locations.map(({ label: _label, ...rest }) => {
        void _label;
        return rest;
      }),
    });
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((i) => `${i.path.join(".") || "project"}: ${i.message}`));
      return null;
    }
    setIssues([]);
    return parsed.data;
  }

  async function save(): Promise<string | null> {
    const payload = buildPayload();
    if (!payload) return null;
    setBusy(true);
    try {
      const project = projectId
        ? await api<{ id: string }>(`/api/v1/discovery-projects/${projectId}`, { method: "PATCH", body: payload })
        : await api<{ id: string }>("/api/v1/discovery-projects", { body: payload });
      setProjectId(project.id);
      setPreview(await api<Preview>(`/api/v1/discovery-projects/${project.id}/preview`, { body: {} }));
      return project.id;
    } catch (error) {
      setIssues([(error as Error).message]);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!projectId) return;
    setBusy(true);
    try {
      await api(`/api/v1/discovery-projects/${projectId}/start`, { body: {} });
      router.push(`/projects/${projectId}`);
    } catch (error) {
      setIssues([(error as Error).message]);
      setBusy(false);
    }
  }

  const includeLocs = locations.filter((l) => l.mode === "INCLUDE");
  const excludeLocs = locations.filter((l) => l.mode === "EXCLUDE");
  const selectedSources = sources.filter((s) => selected[s.id]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <ol className="flex flex-wrap gap-1 text-xs">
          {STEPS.map((label, index) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(index)}
                className={`rounded-full border px-2.5 py-1 ${index === step ? "border-[var(--lf-accent)] bg-[var(--lf-accent)] text-white" : "border-[var(--lf-line)] bg-white"}`}
              >
                {index + 1}. {label}
              </button>
            </li>
          ))}
        </ol>

        <section className="card space-y-4 p-5">
          <h2 className="text-base font-semibold">
            {step + 1}. {STEPS[step]}
          </h2>

          {step === 0 ? (
            <div className="space-y-3">
              <label className="block text-xs">
                <span className="muted">Name</span>
                <input className="input mt-1" {...form.register("name", { required: true })} placeholder="Construction companies in Gothenburg" />
              </label>
              <label className="block text-xs">
                <span className="muted">Description</span>
                <textarea className="input mt-1" rows={3} {...form.register("description")} />
              </label>
              <NumberField label="Target number of companies (record cap)" value={basics.maxCompanies} min={1} max={100000} onChange={(v) => form.setValue("maxCompanies", v ?? 1)} />
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <label className="block text-xs">
                <span className="muted">Geographic mode</span>
                <select className="input mt-1" {...form.register("geographicMode")}>
                  <option value="CITY">City</option>
                  <option value="REGION">Region</option>
                  <option value="COUNTRY">Country</option>
                  <option value="CONTINENT">Continent</option>
                  <option value="WORLDWIDE">Worldwide</option>
                  <option value="CUSTOM">Custom selection</option>
                </select>
              </label>
              <GeoPicker options={geo} value={locations} onChange={setLocations} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="muted">Locations to match</span>
                  <select className="input mt-1" value={settings.locationScope} onChange={(e) => setSettings({ ...settings, locationScope: e.target.value as DiscoveryProjectSettings["locationScope"] })}>
                    <option value="HEADQUARTERS">Headquarters only</option>
                    <option value="ANY_BRANCH">Any branch</option>
                    <option value="ALL">All known locations</option>
                  </select>
                </label>
                <NumberField label="Minimum location confidence (0–1)" value={settings.minLocationConfidence} min={0} max={1} step={0.05} onChange={(v) => setSettings({ ...settings, minLocationConfidence: v ?? 0 })} />
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <KeywordDetector onApply={applySuggestion} />
              <IndustryPicker tree={industries} value={industryFilters} onChange={setIndustryFilters} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="muted">Include keywords (description, products, services; one per line)</span>
                  <textarea className="input mt-1" rows={4} value={includeKeywords} onChange={(e) => setIncludeKeywords(e.target.value)} />
                </label>
                <label className="text-xs">
                  <span className="muted">Exclude keywords</span>
                  <textarea className="input mt-1" rows={4} value={excludeKeywords} onChange={(e) => setExcludeKeywords(e.target.value)} />
                </label>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4 text-sm">
              <div>
                <p className="mb-1 text-xs muted">Employee size band (only where a source states headcount)</p>
                <MultiCheck options={EMPLOYEE_RANGES} value={settings.company.employeeRanges} onChange={(v) => patch("company", { employeeRanges: v })} />
              </div>
              <div>
                <p className="mb-1 text-xs muted">Operating status</p>
                <MultiCheck options={OPERATING} value={settings.company.operatingStatuses} onChange={(v) => patch("company", { operatingStatuses: v })} />
              </div>
              <div>
                <p className="mb-1 text-xs muted">Ownership (requires evidence)</p>
                <MultiCheck options={OWNERSHIP} value={settings.company.ownership} onChange={(v) => patch("company", { ownership: v })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <NumberField label="Founded from" value={settings.company.foundedFrom} onChange={(v) => patch("company", { foundedFrom: v })} />
                <NumberField label="Founded to" value={settings.company.foundedTo} onChange={(v) => patch("company", { foundedTo: v })} />
                <label className="text-xs">
                  <span className="muted">Legal forms (comma separated)</span>
                  <input className="input mt-1" value={settings.company.legalForms.join(", ")} onChange={(e) => patch("company", { legalForms: lines(e.target.value) })} placeholder="AB, GmbH, Ltd" />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle label="Domain required" checked={settings.company.domainRequired} onChange={(v) => patch("company", { domainRequired: v })} hint="Companies without a website are skipped" />
                <Toggle label="HTTPS required" checked={settings.company.httpsRequired} onChange={(v) => patch("company", { httpsRequired: v })} />
                <Toggle label="Description required" checked={settings.company.descriptionRequired} onChange={(v) => patch("company", { descriptionRequired: v })} />
                <Toggle label="Social profiles present" checked={settings.company.socialProfilesRequired} onChange={(v) => patch("company", { socialProfilesRequired: v })} />
                <Toggle label="Has a contact page" checked={settings.website.requireContactPage} onChange={(v) => patch("website", { requireContactPage: v })} />
                <Toggle label="Has a careers page" checked={settings.website.requireCareersPage} onChange={(v) => patch("website", { requireCareersPage: v })} />
                <Toggle label="Has an online shop or booking" checked={settings.website.requireShop} onChange={(v) => patch("website", { requireShop: v })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs">
                  <span className="muted">Website</span>
                  <select className="input mt-1" value={settings.website.presence} onChange={(e) => patch("website", { presence: e.target.value as "ANY" })}>
                    <option value="ANY">Any</option>
                    <option value="EXISTS">Must exist</option>
                    <option value="ABSENT">Must be absent</option>
                  </select>
                </label>
                <label className="text-xs">
                  <span className="muted">Reachability</span>
                  <select className="input mt-1" value={settings.company.websiteReachability} onChange={(e) => patch("company", { websiteReachability: e.target.value as "ANY" })}>
                    <option value="ANY">Any</option>
                    <option value="REACHABLE">Reachable</option>
                    <option value="UNREACHABLE">Unreachable</option>
                    <option value="UNKNOWN">Unknown</option>
                  </select>
                </label>
                <label className="text-xs">
                  <span className="muted">Technologies (heuristic; e.g. WordPress, Shopify)</span>
                  <input className="input mt-1" value={settings.website.technologies.join(", ")} onChange={(e) => patch("website", { technologies: lines(e.target.value) })} />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="muted">Website languages (ISO codes, e.g. sv, en)</span>
                  <input className="input mt-1" value={settings.language.websiteLanguages.join(", ")} onChange={(e) => patch("language", { websiteLanguages: lines(e.target.value) })} />
                </label>
                <Toggle label="Keep sites whose language is unknown" checked={settings.language.allowUnknown} onChange={(v) => patch("language", { allowUnknown: v })} hint="Website language is not a contact's preferred language" />
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4 text-sm">
              <div>
                <p className="mb-1 text-xs muted">Contact categories to extract</p>
                <MultiCheck options={CONTACT_CATEGORIES} value={settings.contacts.categories} onChange={(v) => patch("contacts", { categories: v })} />
              </div>
              <label className="block text-xs">
                <span className="muted">Role-based or named</span>
                <select className="input mt-1" value={settings.contacts.roleMode} onChange={(e) => patch("contacts", { roleMode: e.target.value as "BOTH" })}>
                  <option value="BOTH">Both</option>
                  <option value="ROLE_ONLY">Role-based only (info@, sales@)</option>
                  <option value="NAMED_ONLY">Named professional contacts only, where lawfully published</option>
                </select>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle label="Require a phone number" checked={settings.contacts.requirePhone} onChange={(v) => patch("contacts", { requirePhone: v })} />
                <Toggle label="Require a contact form URL" checked={settings.contacts.requireContactForm} onChange={(v) => patch("contacts", { requireContactForm: v })} />
                <Toggle label="Exclude free-mail addresses" checked={settings.contacts.excludeFreeMail} onChange={(v) => patch("contacts", { excludeFreeMail: v })} />
                <Toggle label="Require syntax-valid email" checked={settings.contacts.requireSyntaxValid} onChange={(v) => patch("contacts", { requireSyntaxValid: v })} />
                <Toggle label="Require MX-valid domain" checked={settings.contacts.requireMxValid} onChange={(v) => patch("contacts", { requireMxValid: v })} hint="MX validity is not proof a mailbox exists" />
                <Toggle label="Require source evidence (always on)" checked onChange={() => undefined} hint="Every contact keeps the page it was found on" />
              </div>
              <NumberField label="Minimum contact confidence (0–1)" value={settings.contacts.minConfidence} min={0} max={1} step={0.05} onChange={(v) => patch("contacts", { minConfidence: v ?? 0 })} />
              <p className="text-xs muted">LeadForge never guesses addresses from name patterns and never probes mailboxes.</p>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-3 text-sm">
              {sources.length === 0 ? <p className="muted">No sources registered. Add one under Sources.</p> : null}
              {sources.map((source) => {
                const usable = source.policyStatus === "APPROVED" && source.enabled && source.permitted;
                return (
                  <div key={source.id} className="rounded border border-[var(--lf-line)] p-3">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" checked={Boolean(selected[source.id])} onChange={(e) => setSelected({ ...selected, [source.id]: e.target.checked })} />
                      <span className="flex-1">
                        <span className="font-medium">{source.name}</span>{" "}
                        <span className={`badge ${usable ? "badge-green" : "badge-amber"}`}>{source.policyStatus}</span>
                        <span className="block text-xs muted">
                          {source.adapter ?? source.sourceType}
                          {source.licenceName ? ` · ${source.licenceName}` : ""}
                          {usable ? "" : " · cannot run until its policy is approved"}
                        </span>
                      </span>
                    </label>
                    {selected[source.id] && source.adapter === "domain_list" ? (
                      <label className="mt-2 block text-xs">
                        <span className="muted">Company domains (one per line)</span>
                        <textarea
                          className="input mt-1 font-mono"
                          rows={5}
                          value={((sourceConfig[source.id]?.domains as string[] | undefined) ?? []).join("\n")}
                          onChange={(e) => setSourceConfig({ ...sourceConfig, [source.id]: { ...sourceConfig[source.id], domains: lines(e.target.value) } })}
                          placeholder={"example.se\nexample.com"}
                        />
                        {(() => {
                          const entered = (sourceConfig[source.id]?.domains as string[] | undefined) ?? [];
                          const invalid = entered.filter((d) => !registrableDomain(d));
                          return invalid.length ? (
                            <span className="mt-1 block text-red-700">
                              Not a public domain, will be skipped: {invalid.slice(0, 5).join(", ")}
                              {invalid.length > 5 ? ` and ${invalid.length - 5} more` : ""}
                            </span>
                          ) : (
                            <span className="mt-1 block muted">{entered.length} domain(s)</span>
                          );
                        })()}
                      </label>
                    ) : null}
                    {selected[source.id] && source.adapter === "open_dataset" ? (
                      <label className="mt-2 block text-xs">
                        <span className="muted">Dataset file under data/imports (optional override)</span>
                        <input
                          className="input mt-1 font-mono"
                          value={(sourceConfig[source.id]?.path as string | undefined) ?? ""}
                          onChange={(e) => setSourceConfig({ ...sourceConfig, [source.id]: { ...sourceConfig[source.id], path: e.target.value || undefined } })}
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {step === 6 ? (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-3">
                <NumberField label="Min. independent source observations" value={settings.quality.minSourceObservations} min={0} max={10} onChange={(v) => patch("quality", { minSourceObservations: v ?? 0 })} />
                <NumberField label="Max record age (days)" value={settings.quality.maxRecordAgeDays} onChange={(v) => patch("quality", { maxRecordAgeDays: v })} />
                <NumberField label="Min. company confidence (0–1)" value={basics.minConfidence} min={0} max={1} step={0.05} onChange={(v) => form.setValue("minConfidence", v ?? 0)} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Toggle label="Official website required" checked={settings.quality.officialWebsiteRequired} onChange={(v) => patch("quality", { officialWebsiteRequired: v })} />
                <Toggle label="Only human-reviewed records" checked={settings.quality.requireReviewed} onChange={(v) => patch("quality", { requireReviewed: v })} />
                <Toggle label="Exclude open duplicates" checked={settings.quality.excludeDuplicates} onChange={(v) => patch("quality", { excludeDuplicates: v })} />
                <Toggle label="Exclude suppressed domains and addresses" checked={settings.exclusions.excludeSuppressed} onChange={(v) => patch("exclusions", { excludeSuppressed: v })} />
                <Toggle label="Skip companies processed by other projects" checked={settings.exclusions.excludePreviouslyProcessed} onChange={(v) => patch("exclusions", { excludePreviouslyProcessed: v })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs">
                  <span className="muted">Excluded domains</span>
                  <textarea className="input mt-1" rows={3} value={settings.exclusions.domains.join("\n")} onChange={(e) => patch("exclusions", { domains: lines(e.target.value) })} />
                </label>
                <label className="text-xs">
                  <span className="muted">Excluded company tags</span>
                  <textarea className="input mt-1" rows={3} value={settings.exclusions.tags.join("\n")} onChange={(e) => patch("exclusions", { tags: lines(e.target.value) })} />
                </label>
                <label className="text-xs">
                  <span className="muted">Excluded keywords</span>
                  <textarea className="input mt-1" rows={3} value={settings.exclusions.keywords.join("\n")} onChange={(e) => patch("exclusions", { keywords: lines(e.target.value) })} />
                </label>
              </div>
              <h3 className="pt-2 text-sm font-semibold">Crawl budget and controls</h3>
              <div className="grid gap-3 sm:grid-cols-4">
                <NumberField label="Max pages per company" value={basics.maxPagesPerCompany} min={1} max={50} onChange={(v) => form.setValue("maxPagesPerCompany", v ?? 1)} />
                <NumberField label="Max crawl depth" value={basics.maxCrawlDepth} min={0} max={5} onChange={(v) => form.setValue("maxCrawlDepth", v ?? 0)} />
                <NumberField label="Requests per domain per minute" value={settings.crawl.requestsPerDomainPerMinute} min={1} max={60} onChange={(v) => patch("crawl", { requestsPerDomainPerMinute: v ?? 1 })} />
                <NumberField label="Global concurrency" value={settings.crawl.globalConcurrency} min={1} max={32} onChange={(v) => patch("crawl", { globalConcurrency: v ?? 1 })} />
                <NumberField label="Timeout (s)" value={settings.crawl.timeoutSeconds} min={5} max={120} onChange={(v) => patch("crawl", { timeoutSeconds: v ?? 20 })} />
                <NumberField label="Retries" value={settings.crawl.retryCount} min={0} max={5} onChange={(v) => patch("crawl", { retryCount: v ?? 0 })} />
                <NumberField label="Max response (MB)" value={settings.crawl.maxResponseMb} min={0.5} max={32} step={0.5} onChange={(v) => patch("crawl", { maxResponseMb: v ?? 8 })} />
                <NumberField label="Recrawl after (days)" value={settings.crawl.freshnessDays} min={0} max={365} onChange={(v) => patch("crawl", { freshnessDays: v ?? 30 })} />
                <NumberField label="Stop after N blocked sites" value={settings.crawl.stopAfterBlocked} min={1} max={100} onChange={(v) => patch("crawl", { stopAfterBlocked: v ?? 5 })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="muted">Allowed URL patterns (regex, one per line)</span>
                  <textarea className="input mt-1 font-mono" rows={2} value={settings.crawl.allowedUrlPatterns.join("\n")} onChange={(e) => patch("crawl", { allowedUrlPatterns: lines(e.target.value) })} />
                </label>
                <label className="text-xs">
                  <span className="muted">Excluded URL patterns</span>
                  <textarea className="input mt-1 font-mono" rows={2} value={settings.crawl.excludedUrlPatterns.join("\n")} onChange={(e) => patch("crawl", { excludedUrlPatterns: lines(e.target.value) })} />
                </label>
              </div>
              <Toggle
                label="Allow browser rendering (Playwright) for JavaScript-only pages"
                checked={settings.crawl.usePlaywright}
                onChange={(v) => patch("crawl", { usePlaywright: v })}
                hint="Used sparingly, only where automated access is permitted; never to bypass access controls"
              />
            </div>
          ) : null}

          {step === 7 ? (
            <div className="space-y-4 text-sm">
              <p className="muted">Save the project to run the server-side preview: policy checks, warnings and a crawl-budget estimate.</p>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? "Saving…" : projectId ? "Save changes and preview" : "Save project and preview"}
              </button>
              {preview ? (
                <div className="space-y-3">
                  {preview.blockers.length ? (
                    <div className="rounded border border-red-300 bg-red-50 p-3">
                      <p className="font-medium text-red-800">Must be resolved before running</p>
                      <ul className="mt-1 list-disc pl-5 text-red-800">{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                    </div>
                  ) : null}
                  {preview.warnings.length ? (
                    <div className="rounded border border-amber-300 bg-amber-50 p-3">
                      <p className="font-medium text-amber-900">Warnings</p>
                      <ul className="mt-1 list-disc pl-5 text-amber-900">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                    </div>
                  ) : null}
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <div className="card p-3">
                      <dt className="text-xs muted">Known companies already in scope</dt>
                      <dd className="text-lg font-semibold">{preview.estimates.knownCompaniesInScope}</dd>
                    </div>
                    <div className="card p-3">
                      <dt className="text-xs muted">Crawl budget</dt>
                      <dd className="text-lg font-semibold">
                        ≤ {preview.budget.maxRequests.toLocaleString("en")} requests · ~{preview.budget.estimatedCrawlHours} h
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs muted">{preview.estimates.note} Estimates are not guarantees of available records.</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 8 ? (
            <div className="space-y-3 text-sm">
              {!projectId ? <p className="muted">Save the project in the Review step first.</p> : null}
              {preview?.requiresApproval && !preview.approved ? (
                <p className="text-amber-900">This is a high-volume project. An admin must approve it on the project page before it can start.</p>
              ) : null}
              <p className="muted">
                Starting creates one discovery run per approved source. Discovered companies are deduplicated, then their
                websites are crawled within the budget. Discovery never adds anyone to a campaign.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" disabled={!projectId || busy || Boolean(preview?.blockers.length)} onClick={start}>
                  Start discovery
                </button>
                {projectId ? (
                  <button type="button" className="btn" onClick={() => router.push(`/projects/${projectId}`)}>
                    Open project without starting
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {issues.length ? (
            <ul className="list-disc rounded border border-red-300 bg-red-50 p-3 pl-6 text-xs text-red-800">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex justify-between border-t border-[var(--lf-line)] pt-3">
            <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn" onClick={() => setStep(step + 1)}>
                Next
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <aside className="card h-fit space-y-3 p-4 text-xs lg:sticky lg:top-6">
        <h2 className="text-sm font-semibold">Scope summary</h2>
        <div>
          <p className="font-medium">{basics.name || "Untitled project"}</p>
          <p className="muted">
            {basics.geographicMode.toLowerCase()} · cap {Number(basics.maxCompanies).toLocaleString("en")} companies
          </p>
        </div>
        <div>
          <p className="muted">Geography</p>
          <p>{basics.geographicMode === "WORLDWIDE" || includeLocs.length === 0 ? "Worldwide" : includeLocs.map((l) => l.label).join("; ")}</p>
          {excludeLocs.length ? <p className="text-red-700">Excluding {excludeLocs.map((l) => l.label).join("; ")}</p> : null}
        </div>
        <div>
          <p className="muted">Industries</p>
          <p>{industryFilters.filter((f) => f.mode === "INCLUDE").map((f) => industryName.get(f.industryId)).join("; ") || "Any"}</p>
          {industryFilters.some((f) => f.mode === "EXCLUDE") ? (
            <p className="text-red-700">
              Excluding {industryFilters.filter((f) => f.mode === "EXCLUDE").map((f) => industryName.get(f.industryId)).join("; ")}
            </p>
          ) : null}
        </div>
        {lines(includeKeywords).length || lines(excludeKeywords).length ? (
          <div>
            <p className="muted">Keywords</p>
            <p>{[...lines(includeKeywords), ...lines(excludeKeywords).map((k) => `−${k}`)].join(", ")}</p>
          </div>
        ) : null}
        <div>
          <p className="muted">Contacts</p>
          <p>
            {settings.contacts.categories.map((c) => c.toLowerCase()).join(", ")} · {settings.contacts.roleMode.replace("_", " ").toLowerCase()}
          </p>
        </div>
        <div>
          <p className="muted">Sources</p>
          <p>{selectedSources.map((s) => `${s.name}${s.policyStatus === "APPROVED" ? "" : " (not approved)"}`).join("; ") || "None selected"}</p>
        </div>
        <div>
          <p className="muted">Crawl budget</p>
          <p>
            {basics.maxPagesPerCompany} pages × depth {basics.maxCrawlDepth} · {settings.crawl.requestsPerDomainPerMinute} req/min/domain
          </p>
        </div>
      </aside>
    </div>
  );
}
