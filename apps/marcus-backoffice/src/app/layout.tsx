import type { Metadata } from "next";
import { AppProviders } from "@/components/app-providers";
import { marcusWebSocketUrl } from "@/lib/marcus/origin";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Marcus Backoffice",
    template: "%s · Marcus",
  },
  description: "Plano de control operativo de Marcus.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main-content">Saltar al contenido</a>
        <AppProviders webSocketUrl={marcusWebSocketUrl()}>{children}</AppProviders>
      </body>
    </html>
  );
}
