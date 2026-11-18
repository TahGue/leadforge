import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/companies", label: "Companies" },
  { href: "/review", label: "Review" },
  { href: "/sources", label: "Sources" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/suppressions", label: "Suppressions" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--lf-line)] bg-white px-3 py-5">
        <div className="px-2">
          <p className="text-sm font-semibold tracking-tight">LeadForge</p>
          <p className="mt-0.5 truncate text-xs muted">{session.organization.name}</p>
        </div>

        <nav className="mt-6 flex-1 space-y-0.5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-2 py-1.5 text-sm text-[var(--lf-ink)] hover:bg-[#f1f1ee]"
            >
              {item.label}
            </Link>
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
