import type { Metadata } from "next";
import { CodeBlock, DocumentationShell, Step } from "@/components/documentation-shell";
import { SITE_URL } from "@/lib/site";

const markdownAgent = `---
schema: marcus.agent/v1
id: support-summary
name: Support Summary
kind: prompt-task
cli-enabled: true
---

# Objective

Resumir un caso de soporte y proponer el próximo paso.

# System

Respondé en español. No inventes datos ausentes.

# Prompt

Analizá el caso recibido y devolvé un resumen operativo.

# Input

\`\`\`yaml schema
object:
  case:
    type: string
    min-length: 1
required: [case]
additional-properties: false
\`\`\`

# Output

\`\`\`yaml schema
object:
  summary:
    type: string
  nextAction:
    type: string
required: [summary, nextAction]
additional-properties: false
\`\`\`

# Rules

- Priorizá hechos verificables.
- Indicá cuando falta información.`;

export const metadata: Metadata = {
  title: "Agentes Markdown de Marcus | Guía completa",
  description: "Aprendé a escribir, validar, subir, compilar y activar agentes declarativos marcus.agent/v1.",
  alternates: { canonical: "/documentacion/markdown" },
  openGraph: { title: "Agentes Markdown de Marcus", description: "Guía completa de autoría declarativa marcus.agent/v1.", url: "/documentacion/markdown" },
};

const toc = [
  { id: "primer-agente", label: "Primer agente" },
  { id: "frontmatter", label: "Frontmatter" },
  { id: "secciones", label: "Secciones" },
  { id: "schemas", label: "Input y Output" },
  { id: "ciclo", label: "Editar y aplicar" },
  { id: "ai", label: "Crear con Marcus AI" },
  { id: "errores", label: "Errores frecuentes" },
] as const;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      headline: "Agentes Markdown de Marcus: guía completa",
      description: "Escribir, validar, subir, compilar y activar agentes declarativos marcus.agent/v1.",
      url: `${SITE_URL}/documentacion/markdown`,
      inLanguage: "es",
      proficiencyLevel: "Beginner",
      author: { "@type": "Organization", name: "Stock42 LLC", url: "https://stock42.com" },
      about: ["Marcus Agentic OS", "Markdown agents", "marcus.agent/v1", "AI agents"],
    },
    {
      "@type": "HowTo",
      name: "Cómo crear y ejecutar un agente Markdown en Marcus",
      step: [
        "Crear y seleccionar un Project",
        "Generar el scaffold Markdown",
        "Definir comportamiento y contratos",
        "Subir y compilar el agente",
        "Ejecutar el primer Run",
      ].map((name, index) => ({ "@type": "HowToStep", position: index + 1, name })),
    },
  ],
};

export default function MarkdownDocumentationPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <DocumentationShell
      active="markdown"
      eyebrow="MARKDOWN · MARCUS.AGENT/V1 · DECLARATIVO"
      title={<>Agentes legibles por humanos. <em>Ejecutables por Marcus.</em></>}
      description="Markdown es la ruta declarativa: identidad, objetivo, instrucciones y contratos viven en un archivo auditable que Marcus compila al mismo manifiesto que un agente SDK."
      toc={toc}
    >
      <section className="doc-section doc-section--lead" id="primer-agente">
        <div className="doc-section__index">01 / PRIMER AGENTE</div>
        <h2>Del scaffold al primer Run</h2>
        <p className="doc-lead">Usá Markdown cuando el comportamiento puede expresarse como instrucciones y schemas, sin lifecycle hooks ni librerías TypeScript personalizadas.</p>
        <a className="doc-studio-cta" href="/studio?format=markdown"><span>PROBALO SIN INSTALAR</span><strong>Convertí tu brief en un agente Markdown</strong><i aria-hidden="true">→</i></a>
        <div className="doc-steps">
          <Step number="01" title="Creá y seleccioná un Project">
            <CodeBlock label="MARCUS CLI" code={'project create support --name "Support"\nuse project support'} />
          </Step>
          <Step number="02" title="Generá el archivo base">
            <p>El scaffold crea un <code>.agent.md</code> con la versión de schema correcta y contratos editables.</p>
            <CodeBlock label="MARCUS CLI" code="agent scaffold ./support-summary --kind markdown" />
          </Step>
          <Step number="03" title="Definí comportamiento y contratos">
            <CodeBlock label="support-summary.agent.md" code={markdownAgent} />
          </Step>
          <Step number="04" title="Subí y compilá">
            <CodeBlock label="MARCUS CLI" code={'put local:./support-summary/support-summary.agent.md project:/agents/support-summary.agent.md\nagent create project:/agents/support-summary.agent.md'} />
          </Step>
          <Step number="05" title="Ejecutá el agente">
            <CodeBlock label="MARCUS CLI" code={'agent run support-summary --input \'{"case":"El cliente no puede ingresar desde ayer."}\''} />
            <p>Marcus valida el input, crea un Run, ejecuta la versión activa y vuelve a validar el output antes de finalizar.</p>
          </Step>
        </div>
      </section>

      <section className="doc-section" id="frontmatter">
        <div className="doc-section__index">02 / FRONTMATTER</div>
        <h2>La cabecera es un contrato, no metadata decorativa</h2>
        <CodeBlock label="FRONTMATTER MÍNIMO" code={`---
schema: marcus.agent/v1
id: support-summary
name: Support Summary
kind: prompt-task
cli-enabled: true
---`} />
        <div className="doc-callout doc-callout--signal"><strong>La primera clave debe ser exacta.</strong><p>Usá siempre <code>schema: marcus.agent/v1</code>. Valores como <code>agent/v1</code>, <code>marcus/v1</code> o <code>v1</code> no pertenecen al contrato.</p></div>
        <div className="doc-api-list">
          <div><code>id</code><p>Identidad kebab-case estable dentro del Project.</p></div>
          <div><code>name / kind</code><p>Nombre visible y tipo: <code>agent</code>, <code>prompt-task</code> o <code>assistant</code>.</p></div>
          <div><code>runtime</code><p>Perfil, residencia y timeouts del Runtime Host.</p></div>
          <div><code>cli-enabled / api-enabled</code><p>Puertas de entrada explícitas para invocar el agente.</p></div>
          <div><code>conversation</code><p>Scope, chat ID, historial, retención e inyección de contexto.</p></div>
          <div><code>rate-limits / concurrency</code><p>Límites y saturación que el Kernel aplica antes de ejecutar.</p></div>
        </div>
      </section>

      <section className="doc-section" id="secciones">
        <div className="doc-section__index">03 / SECCIONES</div>
        <h2>Una estructura que separa intención de ejecución</h2>
        <div className="doc-feature-grid doc-feature-grid--wide">
          <article><span>01</span><h3>Objective</h3><p>Resultado que el agente debe conseguir. Debe ser específico y verificable.</p></article>
          <article><span>02</span><h3>System</h3><p>Instrucciones permanentes, límites y criterios de comportamiento.</p></article>
          <article><span>03</span><h3>Prompt</h3><p>Plantilla operativa aplicada al input de cada Run.</p></article>
          <article><span>04</span><h3>Input / Output</h3><p>Schemas serializables que cierran el contrato del agente.</p></article>
          <article><span>05</span><h3>Rules</h3><p>Restricciones y prioridades adicionales, expresadas sin ambigüedad.</p></article>
          <article><span>06</span><h3>Tools / Execution</h3><p>Capacidades permitidas y comportamiento esperado del loop.</p></article>
          <article><span>07</span><h3>Examples</h3><p>Pares de entrada y salida que fijan forma, tono y casos límite.</p></article>
        </div>
        <p>No todas las secciones son obligatorias, pero <code>Objective</code>, <code>Input</code> y <code>Output</code> hacen que el agente sea determinista de compilar y claro de revisar.</p>
      </section>

      <section className="doc-section" id="schemas">
        <div className="doc-section__index">04 / INPUT Y OUTPUT</div>
        <h2>El modelo no decide el contrato</h2>
        <p>Los bloques <code>yaml schema</code> se compilan de forma determinista. Marcus valida tanto el payload de entrada como el resultado final.</p>
        <CodeBlock label="SCHEMA TIPADO" code={`# Input

\`\`\`yaml schema
object:
  message:
    type: string
    min-length: 1
  priority:
    type: string
    enum: [low, high]
required: [message]
additional-properties: false
\`\`\`

# Output

\`\`\`yaml schema
object:
  accepted:
    type: boolean
  reasons:
    type: array
    items:
      type: string
required: [accepted, reasons]
additional-properties: false
\`\`\``} />
        <p>Definí explícitamente campos requeridos y propiedades adicionales. Eso evita que una respuesta plausible pero incompatible atraviese el límite del Runtime.</p>
      </section>

      <section className="doc-section" id="ciclo">
        <div className="doc-section__index">05 / CICLO DE CAMBIO</div>
        <h2>Editar no cambia producción hasta aplicar</h2>
        <div className="doc-flow" aria-label="Flujo de cambio de un agente Markdown"><span>Editar fuente</span><i>→</i><span>agent diff</span><i>→</i><span>agent apply</span><i>→</i><span>nueva versión activa</span></div>
        <CodeBlock label="MARCUS CLI" code={'agent diff support-summary\nagent apply support-summary\nagent versions support-summary'} />
        <p>La fuente vive en el Project Home. Cada <code>apply</code> válido crea una versión inmutable; las ejecuciones conservan la referencia exacta a la versión que usaron.</p>
      </section>

      <section className="doc-section" id="ai">
        <div className="doc-section__index">06 / MARCUS AI</div>
        <h2>También podés empezar en lenguaje natural</h2>
        <p>En el Backoffice, “Crear agente con AI” envía la descripción al rol <code>markdown.compiler</code> o a <code>agent.default</code>. Marcus muestra el avance operativo, normaliza el contrato, valida el Markdown, corrige un borrador inválido una sola vez y recién entonces compila y activa.</p>
        <div className="doc-callout"><strong>El LLM propone; Marcus decide.</strong><p>El proveedor nunca salta el compilador ni la validación del manifiesto. Su razonamiento interno permanece privado; la interfaz muestra fases y herramientas operativas verificables.</p></div>
      </section>

      <section className="doc-section" id="errores">
        <div className="doc-section__index">07 / ERRORES FRECUENTES</div>
        <h2>Diagnóstico rápido</h2>
        <div className="doc-troubleshooting">
          <article><code>schema must be marcus.agent/v1</code><p>La cabecera falta o usa otro valor. La segunda línea debe ser exactamente <code>schema: marcus.agent/v1</code>.</p></article>
          <article><code>must start with ---</code><p>El archivo no comienza con el delimitador de frontmatter YAML.</p></article>
          <article><code>Agent id must be kebab-case</code><p>Usá minúsculas, números y guiones: <code>support-summary</code>.</p></article>
          <article><code>Agent already exists</code><p>Para una fuente registrada usá <code>agent apply &lt;id&gt;</code>, no <code>agent create</code>.</p></article>
        </div>
        <div className="doc-next"><div><span>SIGUIENTE</span><h3>¿Necesitás lifecycle o librerías?</h3><p>Pasá al SDK TypeScript sin cambiar el modelo de versiones ni operación.</p></div><a href="/documentacion/sdk">Leer SDK TypeScript <span aria-hidden="true">→</span></a></div>
      </section>
      </DocumentationShell>
    </>
  );
}
