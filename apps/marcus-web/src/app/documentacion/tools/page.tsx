import type { Metadata } from "next";
import { MARCUS_OFFICIAL_TOOL_CATALOG, type ToolManifest } from "@marcus/contracts";
import { CodeBlock, DocumentationShell } from "@/components/documentation-shell";
import { SITE_URL } from "@/lib/site";

type ToolGuide = {
  purpose: string;
  example: Record<string, unknown>;
  notes: readonly string[];
};

const guides: Record<string, ToolGuide> = {
  "marcus/files.list": {
    purpose: "Lista los hijos inmediatos de un directorio del Project y devuelve metadata revisionada.",
    example: { path: "project:/agents" },
    notes: ["project:/ es el path por defecto.", "No expone el directorio reservado project:/.marcus."],
  },
  "marcus/files.stat": {
    purpose: "Obtiene kind, tamaño, revisión, hash y fecha de un archivo o directorio.",
    example: { path: "project:/agents/support/index.ts" },
    notes: ["Reconcilia metadata si el archivo cambió fuera de Marcus.", "FILE_NOT_FOUND es explícito; no devuelve null ambiguo."],
  },
  "marcus/files.write": {
    purpose: "Escribe de forma atómica texto UTF-8 o bytes Base64 dentro del Project Home.",
    example: { path: "project:/data/report.json", content: "{\"status\":\"ready\"}", encoding: "utf8", expectedRevision: 4, mediaType: "application/json" },
    notes: ["expectedRevision evita pisar ediciones concurrentes.", "Usá idempotencyKey para reintentos de negocio seguros."],
  },
  "marcus/files.move": {
    purpose: "Mueve o renombra un archivo o directorio dentro del mismo Project.",
    example: { from: "project:/draft/report.md", to: "project:/reports/report.md" },
    notes: ["Actualiza la metadata de todo el subárbol.", "El destino nunca puede escapar del Project Home."],
  },
  "marcus/files.delete": {
    purpose: "Elimina permanentemente un path sólo después de una aprobación humana explícita.",
    example: { path: "project:/tmp/obsolete" },
    notes: ["Es critical y siempre crea un Approval antes de ejecutar.", "No usa la papelera: rechazo, expiración o cancelación impiden el borrado."],
  },
  "marcus/http.request": {
    purpose: "Ejecuta HTTP/HTTPS desde marcusd con límites de request, respuesta, timeout y redirects.",
    example: { url: "https://api.example.com/v1/incidents", method: "POST", headers: { "content-type": "application/json" }, body: "{\"severity\":\"high\"}", maxResponseBytes: 1048576 },
    notes: ["No sigue redirects ni acepta credenciales embebidas en la URL.", "Body máximo 1 MiB; respuesta máxima 4 MiB; omite set-cookie."],
  },
  "marcus/artifacts.create": {
    purpose: "Crea un Artifact inmutable del Run desde contenido inline o un Project File.",
    example: { name: "summary.json", mediaType: "application/json", content: "{\"ok\":true}", encoding: "utf8", visibility: "private" },
    notes: ["Exige exactamente uno entre content y projectPath.", "visibility acepta private, public o signed."],
  },
  "marcus/agents.invoke": {
    purpose: "Invoca otro agente del Project como Run hijo y conserva correlación y política de cierre.",
    example: { agent: "incident-classifier", input: { message: "Database latency is above 2s" }, wait: true, parentClose: "request-cancel" },
    notes: ["agent acepta ID o slug y usa la versión activa.", "parentClose: terminate, request-cancel o detach."],
  },
  "marcus/runs.get": {
    purpose: "Lee estado, output, error y trazas de un Run del mismo Project.",
    example: { runId: "run_..." },
    notes: ["No atraviesa el límite del Project.", "Permite coordinar ejecuciones asincrónicas sin acceso directo a SQLite."],
  },
  "marcus/events.publish": {
    purpose: "Publica un evento durable y dispara los agentes activos vinculados al topic.",
    example: { topic: "orders.ready", payload: { orderId: "ord_42" } },
    notes: ["Devuelve eventId, eventSeq y triggeredRuns.", "El topic admite nombres jerárquicos como orders.ready o crm/contact:updated."],
  },
  "marcus/approvals.request": {
    purpose: "Pausa voluntariamente el Run hasta que una persona aprueba o rechaza una acción.",
    example: { action: "send-customer-notification", prompt: "¿Autorizar el envío al cliente?", data: { customerId: "cus_42" } },
    notes: ["Devuelve el objeto resolution de la decisión.", "Expira a las 24 h y se cancela junto con el Run."],
  },
  "marcus/files.read": {
    purpose: "Lee bytes exactos de un Project File y los devuelve en Base64.",
    example: { path: "project:/agents/support/index.ts" },
    notes: ["Siempre devuelve encoding: base64.", "Usá esta tool cuando el agente necesita una capacidad allowlisteada y auditable."],
  },
  "marcus/files.search": {
    purpose: "Busca texto sin distinguir mayúsculas dentro de los archivos del Project.",
    example: { query: "incident", path: "project:/agents" },
    notes: ["path es opcional.", "Cada resultado incluye path, número de línea y texto coincidente."],
  },
};

const categories = {
  files: ["marcus/files.list", "marcus/files.stat", "marcus/files.write", "marcus/files.move", "marcus/files.delete", "marcus/files.read", "marcus/files.search"],
  integration: ["marcus/http.request", "marcus/artifacts.create"],
  orchestration: ["marcus/agents.invoke", "marcus/runs.get", "marcus/events.publish", "marcus/approvals.request"],
} as const;

const byId = new Map(MARCUS_OFFICIAL_TOOL_CATALOG.map((tool) => [tool.id, tool]));

export const metadata: Metadata = {
  title: "Tools oficiales de Marcus | Catálogo, schemas y seguridad",
  description: "Referencia completa del Tool Runtime: files, HTTP, artifacts, agents, Runs, events, approvals, allowlists, auditoría, idempotencia y defineTool.",
  alternates: { canonical: "/documentacion/tools" },
  openGraph: {
    title: "Tools oficiales de Marcus",
    description: "13 capacidades gobernadas con schemas, riesgo, timeout, idempotencia, auditoría y aprobación humana.",
    url: "/documentacion/tools",
  },
};

const toc = [
  { id: "modelo", label: "Cómo funciona" },
  { id: "uso", label: "Declarar e invocar" },
  { id: "files", label: "Project Files" },
  { id: "integracion", label: "HTTP y Artifacts" },
  { id: "orquestacion", label: "Agentes y Runs" },
  { id: "discovery", label: "Discovery y auditoría" },
  { id: "custom", label: "defineTool" },
] as const;

const structuredData = {
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: "Tools oficiales y Tool Runtime de Marcus",
  description: "Catálogo versionado de capacidades administradas para agentes Marcus.",
  url: `${SITE_URL}/documentacion/tools`,
  inLanguage: "es",
  author: { "@type": "Organization", name: "Stock42 LLC", url: "https://stock42.com" },
  about: MARCUS_OFFICIAL_TOOL_CATALOG.map((tool) => tool.id),
};

export default function ToolsDocumentationPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <DocumentationShell
        active="tools"
        eyebrow="TOOL RUNTIME · 13 CAPACIDADES · AGENTVERSION"
        title={<>Poder para actuar. <em>Control para operar.</em></>}
        description="Cada tool de Marcus tiene contrato, versión, allowlist, timeout, riesgo e idempotencia. marcusd valida y audita cada llamada antes de permitir un efecto real."
        toc={toc}
      >
        <section className="doc-section doc-section--lead" id="modelo">
          <div className="doc-section__index">01 / MODELO OPERATIVO</div>
          <h2>No son helpers. Son capacidades gobernadas.</h2>
          <p className="doc-lead">Una tool sólo existe para un Run si la AgentVersion exacta la incluyó en su manifiesto inmutable. El daemon valida input y output, aplica su política y deja evidencia durable.</p>
          <div className="tool-policy-grid">
            <article><span>01</span><h3>Allowlist</h3><p>Una versión sólo invoca las tools que declaró. El catálogo global no concede permisos.</p></article>
            <article><span>02</span><h3>Schemas</h3><p>Input y output se validan en los dos lados del límite del runtime.</p></article>
            <article><span>03</span><h3>Riesgo</h3><p>Low, medium, high o critical; las críticas exigen Approval humano.</p></article>
            <article><span>04</span><h3>Replay seguro</h3><p>Idempotencia por input o clave del caller, con scope por Run o AgentVersion.</p></article>
            <article><span>05</span><h3>Cancelación</h3><p>Timeout y cancelación viajan por AbortSignal hacia implementaciones cooperativas.</p></article>
            <article><span>06</span><h3>Evidencia</h3><p>tool_calls, eventos Kernel y audit log correlacionados con Run y versión.</p></article>
          </div>
          <div className="doc-callout doc-callout--signal"><strong>El namespace <code>marcus/</code> está reservado.</strong><p>Las tools oficiales tienen versión <code>1.0.0</code>. Una tool custom recibe un hash SHA-256 de su descriptor, por lo que cambiar schemas o política obliga a una nueva versión efectiva.</p></div>
        </section>

        <section className="doc-section" id="uso">
          <div className="doc-section__index">02 / DECLARAR E INVOCAR</div>
          <h2>El permiso vive junto al agente</h2>
          <CodeBlock label="AGENTE TYPESCRIPT" code={`import { defineAgent, m, tools } from "@marcus/sdk";

export default defineAgent({
  id: "report-writer",
  name: "Report Writer",
  input: m.object({ content: m.string() }),
  output: m.object({ path: m.string() }),
  tools: tools.load([
    "marcus/files.write",
    "marcus/events.publish",
  ]),
  async onRun(context, input) {
    const path = "project:/reports/latest.md";
    await context.tools.call(
      "marcus/files.write",
      { path, content: input.content, encoding: "utf8" },
      { idempotencyKey: \`report:\${context.run.id}\` },
    );
    await context.tools.call("marcus/events.publish", {
      topic: "reports.updated",
      payload: { path },
    });
    return { path };
  },
});`} />
          <CodeBlock label="AGENTE MARKDOWN" code={`---
schema: marcus.agent/v1
id: support-operator
name: Support Operator
kind: prompt-task
tools:
  - marcus/files.list
  - marcus/files.read
  - marcus/events.publish
---`} />
          <p>TypeScript también puede incluir implementaciones <code>defineTool</code>. Markdown sólo referencia el catálogo oficial y falla al compilar si el ID no existe.</p>
        </section>

        <ToolGroup id="files" index="03" title="Project Files" subtitle="Leer, descubrir y modificar el Project Home sin entregar acceso directo al filesystem." ids={categories.files} />
        <ToolGroup id="integracion" index="04" title="HTTP y Artifacts" subtitle="Integrar servicios externos y conservar outputs inmutables del Run." ids={categories.integration} />
        <ToolGroup id="orquestacion" index="05" title="Agentes, Runs y decisiones" subtitle="Coordinar trabajo, publicar eventos y detenerse cuando una persona debe decidir." ids={categories.orchestration} />

        <section className="doc-section" id="discovery">
          <div className="doc-section__index">06 / DISCOVERY Y AUDITORÍA</div>
          <h2>El contrato efectivo se puede inspeccionar</h2>
          <CodeBlock label="RUNTIME SDK" code={`const allowlist = await context.tools.list();
const contract = await context.tools.get("marcus/http.request");`} />
          <CodeBlock label="MARCUS CLI" code={`tools list
tools list report-writer
tools list report-writer --version av_...`} />
          <CodeBlock label="REST API" code={`GET /api/v1/projects/prj_.../tools?agent=report-writer
GET /api/v1/projects/prj_.../tools?agentVersionId=av_...`} />
          <div className="doc-flow" aria-label="Flujo de una tool"><span>context.tools.call</span><i>→</i><span>allowlist + schema</span><i>→</i><span>riesgo + idempotencia</span><i>→</i><span>ejecución</span><i>→</i><span>audit + output schema</span></div>
          <p>Un replay completado devuelve el output persistido. Una llamada equivalente todavía activa responde <code>TOOL_IDEMPOTENCY_IN_PROGRESS</code>; Marcus nunca inicia dos efectos porque “quizás” el primero terminó.</p>
        </section>

        <section className="doc-section" id="custom">
          <div className="doc-section__index">07 / DEFINETOOL</div>
          <h2>Extendé el catálogo sin perder gobierno</h2>
          <CodeBlock label="TOOL CUSTOM" code={`const normalizeCustomer = defineTool({
  id: "normalize-customer",
  description: "Normaliza nombre y email.",
  input: m.object({ name: m.string(), email: m.string() }),
  output: m.object({ name: m.string(), email: m.string() }),
  timeout: "2s",
  cancellable: true,
  sideEffects: false,
  risk: "low",
  idempotency: { strategy: "input-hash", scope: "agent-version" },
  async execute(context, input) {
    if (context.signal.aborted) throw context.signal.reason;
    return {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
    };
  },
});`} />
          <p>El descriptor se incorpora al manifiesto; la función permanece dentro del artifact. Antes de ejecutarla, marcusd registra la llamada y devuelve una decisión al Runtime Host. Al finalizar, el worker reporta un output que vuelve a validarse y auditarse.</p>
          <div className="doc-next"><div><span>REFERENCIA MANTENIDA</span><h3>¿Necesitás cada detalle y error?</h3><p>La documentación instalada incluye la misma referencia oficial en <code>TOOLS.md</code>, disponible también para Marcus AI y MCP.</p></div><a href="/documentacion/sdk">Continuar con el SDK <span aria-hidden="true">→</span></a></div>
        </section>
      </DocumentationShell>
    </>
  );
}

function ToolGroup({ id, index, title, subtitle, ids }: { id: string; index: string; title: string; subtitle: string; ids: readonly string[] }) {
  return (
    <section className="doc-section" id={id}>
      <div className="doc-section__index">{index} / CATÁLOGO OFICIAL</div>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      <div className="tool-reference-list">
        {ids.map((toolId) => {
          const tool = byId.get(toolId);
          if (tool === undefined) return null;
          return <ToolReference key={tool.id} tool={tool} guide={guides[tool.id]!} />;
        })}
      </div>
    </section>
  );
}

function ToolReference({ tool, guide }: { tool: ToolManifest; guide: ToolGuide }) {
  return (
    <article className="tool-reference-card">
      <header>
        <div><span className={`tool-risk tool-risk--${tool.risk}`}>{tool.risk}</span><span>{tool.version}</span></div>
        <h3><code>{tool.id}</code></h3>
        <p>{guide.purpose}</p>
      </header>
      <div className="tool-policy-line">
        <span>{tool.sideEffects ? "con efectos" : "read-only"}</span>
        <span>{tool.cancellable ? "cancellable" : "no cancellable"}</span>
        <span>{formatDuration(tool.timeoutMs)}</span>
        <span>{tool.idempotency.strategy}</span>
      </div>
      <CodeBlock label="INPUT DE EJEMPLO" code={JSON.stringify(guide.example, null, 2)} />
      <ul>{guide.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      <details>
        <summary>Schemas exactos: input y output</summary>
        <div className="tool-schema-grid">
          <div><span>INPUT SCHEMA</span><pre><code>{JSON.stringify(tool.inputSchema, null, 2)}</code></pre></div>
          <div><span>OUTPUT SCHEMA</span><pre><code>{JSON.stringify(tool.outputSchema, null, 2)}</code></pre></div>
        </div>
      </details>
    </article>
  );
}

function formatDuration(milliseconds: number): string {
  if (milliseconds >= 86_400_000) return `${milliseconds / 86_400_000}d timeout`;
  if (milliseconds >= 1_000) return `${milliseconds / 1_000}s timeout`;
  return `${milliseconds}ms timeout`;
}
