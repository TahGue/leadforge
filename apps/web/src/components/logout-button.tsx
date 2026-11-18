"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={logout} className="mt-2 w-full px-2 py-1 text-left text-xs muted hover:text-black">
      Sign out
    </button>
  );
}
