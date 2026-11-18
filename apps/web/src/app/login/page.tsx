import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest muted">LeadForge</p>
          <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm muted">Self-hosted lead intelligence.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
