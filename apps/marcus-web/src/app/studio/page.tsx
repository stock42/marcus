import type { Metadata } from "next";
import { AgentStudio } from "@/components/agent-studio";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Agent Studio | Creá agentes de IA con Markdown o TypeScript",
  description: "Diseñá un agente de IA en español, refiná su contrato y descargá una fuente Marcus Markdown o TypeScript validada, sin ejecutar ni desplegar código.",
  keywords: ["crear agente de IA", "agente IA Markdown", "SDK TypeScript agentes", "generador de agentes IA", "Marcus Agent Studio"],
  alternates: { canonical: "/studio" },
  openGraph: {
    title: "Marcus Agent Studio | Del brief a un agente portable",
    description: "Convertí una idea en un contrato de agente Markdown o TypeScript validado por Marcus.",
    url: "/studio",
    type: "website",
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Marcus Agent Studio",
  url: `${SITE_URL}/studio`,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  inLanguage: "es",
  isAccessibleForFree: true,
  description: "Laboratorio público para diseñar y validar agentes Marcus en Markdown o TypeScript sin ejecutarlos ni desplegarlos.",
  creator: { "@type": "Organization", name: "Stock42 LLC", url: "https://stock42.com" },
};

export default function StudioPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <AgentStudio />
    </>
  );
}
