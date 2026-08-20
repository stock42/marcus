import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/documentation-shell";
import { MarketingShell } from "@/components/marketing-shell";
import { MARKDOWN_EXAMPLES, MCP_EXAMPLES } from "@/data/public-content";
import { SITE_NAME, SITE_URL, SOCIAL_IMAGE } from "@/lib/site";

const USER_MANUAL_PATH = "/downloads/marcus-manual-de-usuario-es-0.1.0-rev3.pdf";

export const metadata: Metadata = {
  title: "Documentación de Marcus | SDK, agentes Markdown y MCP",
  description: "Guías y ejemplos completos para crear, compilar y operar agentes Marcus con TypeScript, Markdown, Codex, Claude y el MCP administrativo.",
  alternates: { canonical: "/documentacion" },
  openGraph: {
    title: "Documentación de Marcus Agentic OS",
    description: "SDK TypeScript, agentes Markdown, Tool Runtime y flujos MCP para Codex y Claude.",
    url: "/documentacion",
    siteName: SITE_NAME,
    locale: "es_ES",
    type: "website",
    images: [{ url: SOCIAL_IMAGE, width: 1731, height: 909 }],
  },
  twitter: { card: "summary_large_image", title: "Documentación de Marcus Agentic OS", description: "SDK, Markdown, Tool Runtime y MCP para construir agentes operables.", images: [SOCIAL_IMAGE] },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Documentación de Marcus Agentic OS",
  description: "Guías y ejemplos para construir agentes Marcus con TypeScript, Markdown y MCP.",
  url: `${SITE_URL}/documentacion`,
  inLanguage: "es",
  hasPart: [
    ...[
      ["SDK TypeScript", "/documentacion/sdk"],
      ["Agentes Markdown", "/documentacion/markdown"],
      ["Tools oficiales", "/documentacion/tools"],
    ].map(([name, path]) => ({ "@type": "TechArticle", name, url: `${SITE_URL}${path}` })),
    {
      "@type": "DigitalDocument",
      name: "Marcus - Manual de Usuario 0.1.0",
      inLanguage: "es",
      encodingFormat: "application/pdf",
      contentUrl: `${SITE_URL}${USER_MANUAL_PATH}`,
    },
  ],
};

const authoringPaths = [
  {
    index: "01",
    tag: "SDK TYPESCRIPT",
    mark: ".ts",
    title: "Lógica Bun-native y contratos tipados.",
    body: "Elegí el SDK para lifecycle propio, librerías TypeScript, tools personalizadas y tests de unidad.",
    href: "/documentacion/sdk",
    link: "Abrir guía SDK",
  },
  {
    index: "02",
    tag: "AGENTES MARKDOWN",
    mark: ".md",
    title: "Intención legible, ejecución compilada.",
    body: "Definí identidad, instrucciones, schemas y tools oficiales en un archivo auditable marcus.agent/v1.",
    href: "/documentacion/markdown",
    link: "Abrir guía Markdown",
  },
  {
    index: "03",
    tag: "TOOL RUNTIME",
    mark: "13×",
    title: "Capacidades bajo política.",
    body: "Consultá schemas, riesgo, timeout, cancelación, idempotencia, auditoría y aprobación humana.",
    href: "/documentacion/tools",
    link: "Explorar tools oficiales",
  },
] as const;

export default function DocumentationHubPage() {
  return (
    <MarketingShell active="documentation">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <section className="marketing-hero marketing-hero--docs" aria-labelledby="documentation-title">
        <div className="content-width marketing-hero__grid">
          <div>
            <div className="docs-eyebrow"><span />DOCUMENTACIÓN / PLAYBOOKS / MCP</div>
            <h1 id="documentation-title">Del brief al agente <em>operable.</em></h1>
          </div>
          <div className="marketing-hero__aside">
            <p>Referencias humanas y ejemplos listos para llevar una idea a una AgentVersion activa, observable y gobernada.</p>
            <div className="marketing-hero__facts"><span>3 rutas de autoría</span><span>13 tools oficiales</span><span>59 tools MCP</span></div>
            <a
              aria-label="Descargar Manual de Usuario de Marcus 0.1.0 revisión 3 en PDF"
              className="docs-manual-download"
              download="Marcus_Manual_de_Usuario_ES_0.1.0.rev3.pdf"
              href={USER_MANUAL_PATH}
            >
              <span className="docs-manual-download__mark" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14" /></svg>
              </span>
              <span className="docs-manual-download__copy">
                <small>MANUAL DE USUARIO · ESPAÑOL</small>
                <strong>Marcus 0.1.0</strong>
                <span>Revisión 3 · PDF · 44 páginas · 423 KB</span>
              </span>
              <span className="docs-manual-download__action" aria-hidden="true">DESCARGAR ↘</span>
            </a>
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--paper" aria-labelledby="choose-path-title">
        <div className="content-width">
          <div className="marketing-section__heading">
            <span>01 / ELEGÍ LA RUTA</span>
            <div><h2 id="choose-path-title">Una base común.<br /><em>Tres puertas de entrada.</em></h2><p>TypeScript y Markdown compilan al mismo contrato. El Tool Runtime define qué puede hacer cada versión.</p></div>
          </div>
          <div className="authoring-docs__grid docs-hub-paths">
            {authoringPaths.map((path, index) => (
              <Link className={`authoring-guide${index === 1 ? " authoring-guide--markdown" : index === 2 ? " authoring-guide--tools" : ""}`} href={path.href} key={path.href}>
                <div className="authoring-guide__top"><span>{path.index} / {path.tag}</span><strong>{path.mark}</strong></div>
                <h3>{path.title}</h3>
                <p>{path.body}</p>
                <span className="authoring-guide__link">{path.link}<i aria-hidden="true">→</i></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section example-library" aria-labelledby="markdown-examples-title">
        <div className="content-width">
          <div className="marketing-section__heading marketing-section__heading--dark">
            <span>02 / MARKDOWN BY EXAMPLE</span>
            <div><h2 id="markdown-examples-title">Tres agentes.<br /><em>Tres niveles de control.</em></h2><p>Los ejemplos usan sintaxis aceptada por el compilador y tools que existen en el catálogo oficial.</p></div>
          </div>
          <div className="example-library__list">
            {MARKDOWN_EXAMPLES.map((example, index) => (
              <article className="example-card" key={example.id}>
                <header><span>{String(index + 1).padStart(2, "0")} / {example.label}</span><h3>{example.title}</h3><p>{example.description}</p></header>
                <details open={index === 0}>
                  <summary>Ver fuente completa <span aria-hidden="true">+</span></summary>
                  <CodeBlock label={`${example.id}.agent.md`} code={example.source} />
                  <div className="example-card__input"><span>INPUT DE PRUEBA</span><code>{example.input}</code></div>
                </details>
              </article>
            ))}
          </div>
          <div className="marketing-inline-cta"><p>La guía de Markdown explica frontmatter, schemas, edición, compilación y errores.</p><Link href="/documentacion/markdown">Leer referencia completa <span aria-hidden="true">→</span></Link></div>
        </div>
      </section>

      <section className="marketing-section mcp-workbench" aria-labelledby="mcp-title">
        <div className="content-width">
          <div className="marketing-section__heading">
            <span>03 / CODEX + CLAUDE</span>
            <div><h2 id="mcp-title">Tu agente de desarrollo entra por <em>MCP.</em></h2><p>Marcus le entrega documentación oficial, Projects, archivos, builds y Runs a Codex o Claude sin entregarles un atajo alrededor del Kernel.</p></div>
          </div>

          <div className="mcp-connect-grid">
            <article><span>CODEX</span><h3>Conectá el servidor local</h3><p>Guardá el bearer sólo en <code>MARCUS_MCP_TOKEN</code> y referencialo desde <code>~/.codex/config.toml</code>.</p><CodeBlock label="~/.codex/config.toml" code={MCP_EXAMPLES.codex} /></article>
            <article><span>CLAUDE CODE</span><h3>Registralo por Streamable HTTP</h3><p>Usá un token MCP global dedicado por máquina o integración. Marcus lo reautentica en cada request.</p><CodeBlock label="TERMINAL" code={MCP_EXAMPLES.claude} /></article>
          </div>

          <ol className="mcp-sequence" aria-label="Flujo recomendado para crear un agente con MCP">
            <li><span>01</span><div><strong>Cargar contexto</strong><p><code>documentation_bundle</code> entrega el corpus Markdown o SDK mantenido por Marcus.</p></div></li>
            <li><span>02</span><div><strong>Planificar sin escribir</strong><p><code>agents_plan</code> devuelve contrato, tools, archivos, riesgos y estrategia de prueba.</p></div></li>
            <li><span>03</span><div><strong>Aprobar el cambio</strong><p>El cliente muestra el plan; la escritura comienza sólo después de tu aprobación explícita.</p></div></li>
            <li><span>04</span><div><strong>Crear y verificar</strong><p>Marcus compila, versiona y activa; el cliente inspecciona agente, versiones, diff y Runs reales.</p></div></li>
          </ol>

          <div className="mcp-recipes">
            <article><span>PLAN PRIMERO</span><CodeBlock label="SECUENCIA MCP" code={MCP_EXAMPLES.plan} /></article>
            <article><span>AGENTE MARKDOWN</span><CodeBlock label="TOOLS MCP" code={MCP_EXAMPLES.markdown} /></article>
            <article><span>AGENTE TYPESCRIPT</span><CodeBlock label="TOOLS MCP" code={MCP_EXAMPLES.sdk} /></article>
          </div>

          <div className="mcp-security-note"><strong>El token abre la administración global.</strong><p>No lo pegues en prompts ni archivos. Cada mutación sigue pasando por RBAC, validación, versiones y auditoría; las operaciones destructivas requieren confirmación.</p></div>
        </div>
      </section>

      <section className="marketing-close" aria-labelledby="docs-close-title">
        <div className="content-width"><span>LISTO PARA CONSTRUIR</span><h2 id="docs-close-title">Elegí una ruta.<br />Marcus conserva <em>el control.</em></h2><div><Link className="button button--signal" href="/documentacion/markdown">Crear con Markdown</Link><Link className="text-link text-link--light" href="/documentacion/sdk">Crear con TypeScript <span aria-hidden="true">→</span></Link></div></div>
      </section>
    </MarketingShell>
  );
}
