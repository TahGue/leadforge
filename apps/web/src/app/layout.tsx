import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeadForge",
  description: "Self-hosted B2B lead intelligence and compliant outreach",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
