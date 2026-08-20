import type { Metadata, Viewport } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, SOCIAL_IMAGE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: "Marcus Agentic OS | Infraestructura para agentes de IA",
  description: SITE_DESCRIPTION,
  keywords: [
    "agentes de inteligencia artificial",
    "infraestructura agéntica",
    "Agentic OS",
    "agentes de IA self-hosted",
    "orquestación de agentes de IA",
    "plataforma de agentes de IA",
    "Marcus",
  ],
  authors: [{ name: "Stock42 LLC", url: "https://stock42.com" }],
  creator: "Stock42 LLC",
  publisher: "Stock42 LLC",
  category: "technology",
  alternates: {
    canonical: "/",
    languages: { es: "/", "x-default": "/" },
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "Marcus Agentic OS | Infraestructura para agentes de IA",
    description: SITE_DESCRIPTION,
    type: "website",
    locale: "es_ES",
    url: "/",
    siteName: SITE_NAME,
    images: [
      {
        url: SOCIAL_IMAGE,
        width: 1731,
        height: 909,
        alt: "Marcus Agentic OS: construí, ejecutá y escalá agentes de inteligencia artificial",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Marcus Agentic OS | Infraestructura para agentes de IA",
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

export const viewport: Viewport = { themeColor: "#11130f" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
