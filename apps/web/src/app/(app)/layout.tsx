import Link from "next/link";
import { redirect } from "next/navigation";
import { features } from "@leadforge/pipeline";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

const NAV: { section: string; items: { href: string; label: string }[] }[] = [
  { section: "", items: [{ href: "/dashboard", label: "Dashboard" }, { href: "/explorer", label: "Market Explorer" }] },
  { section: "Discovery", items: [{ href: "/projects", label: "Discovery projects" }, { href: "/jobs", label: "Jobs" }] },
  {
    section: "Data",
    items: [
      { href: "/companies", label: "Companies" },
      { href: "/contacts", label: "Contacts" },
      { href: "/duplicates", label: "Duplicate review" },
      { href: "/review", label: "Extraction review" },
      { href: "/data-quality", label: "Data quality" },
    ],
  },
  {
    section: "Governance",
    items: [
      { href: "/sources", label: "Sources" },
      { href: "/suppressions", label: "Suppression list" },
      { href: "/audit", label: "Audit log" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const nav = features.campaigns
    ? [...NAV, { section: "Outreach (Phase 9)", items: [{ href: "/campaigns", label: "Campaigns" }] }]
    : NAV;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--lf-line)] bg-white px-3 py-5">
        <div className="px-2">
          <p className="text-sm font-semibold tracking-tight">LeadForge</p>
          <p className="mt-0.5 truncate text-xs muted">{session.organization.name}</p>
        </div>
        <nav className="mt-5 flex-1 space-y-4">
          {nav.map((group) => (
            <div key={group.section || "main"}>
              {group.section ? <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide muted">{group.section}</p> : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <Link key={item.href} href={item.href} className="block rounded-md px-2 py-1.5 text-sm text-[var(--lf-ink)] hover:bg-[#f1f1ee]">
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-[var(--lf-line)] pt-3">
          <p className="truncate px-2 text-xs muted">{session.user.email}</p>
          <p className="px-2 text-xs muted">{session.role}</p>
          <LogoutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-7">{children}</main>
    </div>
  );
}
