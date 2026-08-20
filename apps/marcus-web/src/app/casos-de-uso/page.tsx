import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { USE_CASES } from "@/data/public-content";
import { SITE_NAME, SITE_URL, SOCIAL_IMAGE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Casos de uso de agentes de IA | Marcus Agentic OS",
  description: "Ejemplos concretos de agentes Marcus para soporte, operaciones, incidentes, documentos, conocimiento interno e integraciones empresariales.",
  alternates: { canonical: "/casos-de-uso" },
  openGraph: { title: "Casos de uso de Marcus Agentic OS", description: "Agentes de IA operables para procesos reales de empresa.", url: "/casos-de-uso", siteName: SITE_NAME, locale: "es_ES", type: "website", images: [{ url: SOCIAL_IMAGE, width: 1731, height: 909 }] },
  twitter: { card: "summary_large_image", title: "Casos de uso de Marcus Agentic OS", description: "Agentes operables para soporte, operaciones, incidentes e integraciones.", images: [SOCIAL_IMAGE] },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Casos de uso de Marcus Agentic OS",
  url: `${SITE_URL}/casos-de-uso`,
  inLanguage: "es",
  mainEntity: {
    "@type": "ItemList",
    itemListElement: USE_CASES.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.title, description: item.summary })),
  },
};

export default function UseCasesPage() {
  return (
    <MarketingShell active="use-cases">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <section className="marketing-hero marketing-hero--cases" aria-labelledby="cases-title">
        <div className="content-width marketing-hero__grid">
          <div><div className="docs-eyebrow"><span />CASOS DE USO / DE LA IDEA AL RUN</div><h1 id="cases-title">Agentes que viven en <em>la operación.</em></h1></div>
          <div className="marketing-hero__aside"><p>Marcus no prescribe un chatbot universal. Te deja construir agentes especializados, conectarlos a sistemas reales y gobernar cada efecto.</p><div className="marketing-hero__facts"><span>6 patrones</span><span>2 formatos</span><span>1 autoridad</span></div></div>
        </div>
      </section>

      <section className="marketing-section marketing-section--paper" aria-labelledby="patterns-title">
        <div className="content-width">
          <div className="marketing-section__heading"><span>01 / PATRONES OPERATIVOS</span><div><h2 id="patterns-title">El modelo razona.<br /><em>Marcus gobierna.</em></h2><p>Cada caso combina un contrato, una allowlist de tools, una versión inmutable y evidencia observable.</p></div></div>
          <div className="use-case-grid">
            {USE_CASES.map((useCase, index) => (
              <article className="use-case-card" id={useCase.slug} key={useCase.slug}>
                <header><span>{String(index + 1).padStart(2, "0")} / {useCase.sector}</span><h3>{useCase.title}</h3><p>{useCase.summary}</p></header>
                <dl><div><dt>Entrada</dt><dd>{useCase.input}</dd></div><div><dt>Control</dt><dd>{useCase.control}</dd></div><div><dt>Resultado</dt><dd>{useCase.outcome}</dd></div></dl>
                <div className="use-case-card__tools" aria-label="Tools aplicables">{useCase.capabilities.map((tool) => <code key={tool}>{tool}</code>)}</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section authoring-decision" aria-labelledby="format-title">
        <div className="content-width">
          <div className="marketing-section__heading marketing-section__heading--dark"><span>02 / IMPLEMENTACIÓN</span><div><h2 id="format-title">La complejidad define <em>el formato.</em></h2><p>No todo agente necesita código; tampoco todo proceso cabe en instrucciones declarativas.</p></div></div>
          <div className="decision-grid">
            <article><span>MARKDOWN</span><h3>El comportamiento es declarativo</h3><ul><li>Prompt, reglas y contratos claros</li><li>Tools oficiales del catálogo Marcus</li><li>Revisión por equipos técnicos y de negocio</li><li>Compilación determinista a marcus.agent/v1</li></ul><Link href="/documentacion/markdown">Ver agentes Markdown <span aria-hidden="true">→</span></Link></article>
            <article><span>TYPESCRIPT SDK</span><h3>Necesitás lógica y lifecycle propios</h3><ul><li>Librerías Bun-compatible</li><li>Tools personalizadas con defineTool</li><li>Hooks, tests y composición tipada</li><li>Control preciso del Runtime Context</li></ul><Link href="/documentacion/sdk">Ver SDK TypeScript <span aria-hidden="true">→</span></Link></article>
          </div>
        </div>
      </section>

      <section className="marketing-close" aria-labelledby="cases-close-title"><div className="content-width"><span>DEL PROCESO AL AGENTE</span><h2 id="cases-close-title">Empezá por un caso.<br />Escalá sin perder <em>gobierno.</em></h2><div><Link className="button button--signal" href="/documentacion">Ver ejemplos completos</Link><Link className="text-link text-link--light" href="/empresas">Evaluar para mi empresa <span aria-hidden="true">→</span></Link></div></div></section>
    </MarketingShell>
  );
}
