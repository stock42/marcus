import type { Metadata } from "next";
import { CodeBlock, DocumentationShell, Step } from "@/components/documentation-shell";
import { SITE_URL } from "@/lib/site";

const minimalAgent = `import { defineAgent, m } from "@marcus/sdk";

export default defineAgent({
  id: "hello",
  name: "Hello",
  description: "Saluda a una persona por su nombre.",
  input: m.object({
    name: m.string({ minLength: 1 }),
  }),
  output: m.object({
    message: m.string(),
  }),
  entrypoints: {
    cli: { enabled: true },
  },
  async onRun(context, input) {
    context.progress.report({ stage: "saludando" });
    return { message: \`Hola, \${input.name}.\` };
  },
});`;

const modelAgent = `export default defineAgent({
  id: "incident-classifier",
  name: "Incident Classifier",
  input: m.object({ incident: m.string() }),
  output: m.object({
    severity: m.enum(["low", "medium", "high"]),
    summary: m.string(),
  }),
  async onRun(context, input) {
    const response = await context.model.generate({
      messages: [{ role: "user", content: input.incident }],
      output: m.object({
        severity: m.enum(["low", "medium", "high"]),
        summary: m.string(),
      }),
      thinking: true,
      reasoningEffort: "high",
    });
    return response.output;
  },
});`;

export const metadata: Metadata = {
  title: "SDK TypeScript de Marcus | Guía completa",
  description: "Aprendé a crear, probar, subir, compilar y ejecutar agentes TypeScript Bun-native con @marcus/sdk.",
  alternates: { canonical: "/documentacion/sdk" },
  openGraph: { title: "SDK TypeScript de Marcus", description: "Guía completa para crear agentes Bun-native y operarlos con Marcus.", url: "/documentacion/sdk" },
};

const toc = [
  { id: "primer-agente", label: "Primer agente" },
  { id: "anatomia", label: "Anatomía" },
  { id: "schemas", label: "Schemas tipados" },
  { id: "contexto", label: "Runtime context" },
  { id: "modelos-tools", label: "Modelos y tools" },
  { id: "entrypoints", label: "Entrypoints y seguridad" },
  { id: "testing", label: "Pruebas" },
] as const;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TechArticle",
      headline: "SDK TypeScript de Marcus: guía completa",
      description: "Crear, probar, subir, compilar y ejecutar agentes TypeScript Bun-native con @marcus/sdk.",
      url: `${SITE_URL}/documentacion/sdk`,
      inLanguage: "es",
      proficiencyLevel: "Beginner",
      author: { "@type": "Organization", name: "Stock42 LLC", url: "https://stock42.com" },
      about: ["Marcus Agentic OS", "Bun", "TypeScript", "AI agents"],
    },
    {
      "@type": "HowTo",
      name: "Cómo crear y ejecutar un agente TypeScript en Marcus",
      step: [
        "Instalar e iniciar Marcus",
        "Crear y seleccionar un Project",
        "Generar el scaffold SDK",
        "Escribir el contrato y handler",
        "Subir, compilar y ejecutar el agente",
      ].map((name, index) => ({ "@type": "HowToStep", position: index + 1, name })),
    },
  ],
};

export default function SdkDocumentationPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <DocumentationShell
      active="sdk"
      eyebrow="SDK TYPESCRIPT · BUN NATIVE · SIN DIST"
      title={<>De un archivo TypeScript a un agente <em>versionado.</em></>}
      description="Esta guía recorre el circuito completo: crear el proyecto, escribir un contrato tipado, subir la fuente a Marcus, compilar una versión inmutable y ejecutar el primer Run."
      toc={toc}
    >
      <section className="doc-section doc-section--lead" id="primer-agente">
        <div className="doc-section__index">01 / PRIMER AGENTE</div>
        <h2>Tu primer agente TypeScript, paso a paso</h2>
        <p className="doc-lead">El SDK publica TypeScript nativo. Bun ejecuta y empaqueta la fuente; no necesitás generar JavaScript ni crear un directorio <code>dist/</code>.</p>
        <a className="doc-studio-cta" href="/studio?format=typescript"><span>PROBALO SIN INSTALAR</span><strong>Diseñá una fuente TypeScript en Agent Studio</strong><i aria-hidden="true">→</i></a>
        <div className="doc-steps">
          <Step number="01" title="Instalá e iniciá Marcus">
            <p>Instalá el CLI y el servidor. Luego levantá <code>marcusd</code>, completá el bootstrap si es la primera vez e ingresá a la consola con <code>marcus</code>.</p>
            <CodeBlock label="SHELL" code={'curl -fsSL https://projectmarcus.com/install | sh\nexport PATH="$HOME/.marcus/bin:$PATH"\nmarcusd'} />
          </Step>
          <Step number="02" title="Creá y seleccioná un Project">
            <p>El Project es la frontera de archivos, permisos, agentes, Runs y auditoría.</p>
            <CodeBlock label="MARCUS CLI" code={'project create first-agent --name "First Agent"\nuse project first-agent'} />
          </Step>
          <Step number="03" title="Generá el scaffold local">
            <p>Este comando crea <code>hello/index.ts</code> y un <code>package.json</code> Bun-first con <code>@marcus/sdk</code>.</p>
            <CodeBlock label="MARCUS CLI" code="agent scaffold ./hello --kind sdk" />
            <p>En otra terminal, instalá la dependencia declarada por el scaffold antes de probar el agente localmente.</p>
            <CodeBlock label="SHELL" code={'cd hello\nbun install\ncd ..'} />
          </Step>
          <Step number="04" title="Escribí el contrato y el handler">
            <p>La entrada y la salida se validan en runtime y se infieren en TypeScript. El handler sólo puede devolver una salida compatible.</p>
            <CodeBlock label="hello/index.ts" code={minimalAgent} />
          </Step>
          <Step number="05" title="Subí, compilá y ejecutá">
            <p><code>put</code> copia la fuente al Project Home. <code>agent create</code> construye y activa la primera AgentVersion; <code>agent run</code> crea un Run observable.</p>
            <CodeBlock label="MARCUS CLI" code={'put local:./hello/index.ts project:/agents/hello/index.ts\nagent create project:/agents/hello/index.ts\nagent run hello --input \'{"name":"Ada"}\''} />
            <div className="doc-result"><span>RESULTADO ESPERADO</span><code>{'{ "message": "Hola, Ada." }'}</code></div>
          </Step>
        </div>
      </section>

      <section className="doc-section" id="anatomia">
        <div className="doc-section__index">02 / ANATOMÍA</div>
        <h2>Una definición, cinco garantías</h2>
        <div className="doc-feature-grid">
          <article><span>01</span><h3>Identidad estable</h3><p><code>id</code> usa kebab-case y se convierte en la identidad del manifiesto <code>marcus.agent/v1</code>.</p></article>
          <article><span>02</span><h3>Contrato ejecutable</h3><p><code>input</code> y <code>output</code> validan cada invocación en los límites del Runtime.</p></article>
          <article><span>03</span><h3>Versión inmutable</h3><p>Cada build registra hashes de fuente, manifiesto y artifact antes de activarse.</p></article>
          <article><span>04</span><h3>Contexto administrado</h3><p>Logs, progreso, modelos, tools, archivos, secretos y aprobaciones pasan por Marcus.</p></article>
          <article><span>05</span><h3>Ciclo de vida</h3><p>Podés implementar <code>onStart</code>, <code>onRun</code>, <code>onResume</code>, <code>onCancel</code>, <code>onError</code> y <code>onEnd</code>.</p></article>
        </div>
        <div className="doc-callout"><strong>Tres formas de autoría.</strong><p><code>defineAgent</code> entrega control explícito; <code>definePromptTask</code> resuelve una tarea de modelo; <code>defineAssistant</code> agrega un loop conversacional.</p></div>
      </section>

      <section className="doc-section" id="schemas">
        <div className="doc-section__index">03 / SCHEMAS</div>
        <h2>Tipos que también validan</h2>
        <p>La DSL <code>m</code> serializa el contrato para el manifiesto y mantiene inferencia estática. Los objetos rechazan propiedades adicionales por defecto.</p>
        <CodeBlock label="SCHEMA DSL" code={`const Input = m.object({
  email: m.string({ format: "email" }),
  priority: m.default(m.enum(["low", "high"]), "low"),
  attempts: m.integer({ minimum: 0, maximum: 5 }),
  tags: m.optional(m.array(m.string(), { uniqueItems: true })),
  metadata: m.record(m.string()),
});

type Input = m.Infer<typeof Input>;`} />
        <div className="doc-inline-list"><span><code>m.string</code></span><span><code>m.number</code></span><span><code>m.integer</code></span><span><code>m.boolean</code></span><span><code>m.literal</code></span><span><code>m.enum</code></span><span><code>m.object</code></span><span><code>m.array</code></span><span><code>m.record</code></span><span><code>m.union</code></span><span><code>m.optional</code></span><span><code>m.nullable</code></span><span><code>m.default</code></span></div>
      </section>

      <section className="doc-section" id="contexto">
        <div className="doc-section__index">04 / RUNTIME CONTEXT</div>
        <h2>Todo efecto importante pasa por Marcus</h2>
        <div className="doc-api-list">
          {[
            ["logger", "Logs estructurados, redactables y correlacionados con el Run."],
            ["progress", "Etapa, mensaje y avance observable; también estados de espera."],
            ["model", "Generación por roles de modelo con output tipado y Thinking controlado."],
            ["tools", "Invocación de capacidades registradas y auditables."],
            ["agents", "Subagentes secuenciales o paralelos con política de cierre."],
            ["messages / events", "Mensajería durable y publicación de eventos del Project."],
            ["conversation", "Historial y metadata cuando el agente habilita conversación."],
            ["checkpoint", "Estado reanudable con versión de schema y resume key."],
            ["artifacts / files", "Resultados binarios y acceso controlado al Project Home."],
            ["secrets / approvals", "Secretos sin hardcode y decisiones humanas explícitas."],
          ].map(([name, description]) => <div key={name}><code>context.{name}</code><p>{description}</p></div>)}
        </div>
      </section>

      <section className="doc-section" id="modelos-tools">
        <div className="doc-section__index">05 / MODELOS Y TOOLS</div>
        <h2>LLM tipado, razonamiento privado</h2>
        <p><code>context.model.generate</code> usa el rol configurado en Marcus. Si declarás <code>output</code>, la respuesta se valida antes de volver al agente. El razonamiento interno del proveedor no forma parte del output ni del Run.</p>
        <CodeBlock label="AGENTE CON MODELO" code={modelAgent} />
        <p>Para tools administradas, usá <code>context.tools.call(tool, input)</code>. Para crear una tool propia, exportá <code>defineTool</code> con schemas, timeout y metadata de riesgo; las tools con efectos laterales deben declararlo.</p>
      </section>

      <section className="doc-section" id="entrypoints">
        <div className="doc-section__index">06 / ENTRYPOINTS Y SEGURIDAD</div>
        <h2>Una definición, varias puertas de entrada</h2>
        <CodeBlock label="ENTRYPOINTS" code={`entrypoints: {
  cli: { enabled: true },
  api: {
    enabled: true,
    response: { mode: "auto", wait: "15s" },
    authentication: { type: "marcus-token" },
  },
  schedules: [{ id: "daily", cron: "0 9 * * *", timezone: "America/Argentina/Buenos_Aires" }],
  events: [{ topic: "orders.created" }],
  messages: { enabled: true },
}`} />
        <p>La API admite <code>marcus-token</code>, <code>bearer-secret</code>, <code>hmac</code>, validadores reutilizables y acceso público explícito. Nunca hardcodees credenciales: guardalas como secretos de Marcus.</p>
      </section>

      <section className="doc-section" id="testing">
        <div className="doc-section__index">07 / TESTING</div>
        <h2>Probalo antes de subirlo</h2>
        <CodeBlock label="hello/index.test.ts" code={`import { expect, test } from "bun:test";
import { createAgentTestHarness } from "@marcus/sdk/testing";
import agent from "./index.ts";

test("greets a person", async () => {
  const harness = createAgentTestHarness(agent);
  const result = await harness.run({ name: "Ada" });
  expect(result.output).toEqual({ message: "Hola, Ada." });
});`} />
        <CodeBlock label="SHELL" code="cd hello\nbun install\nbun test" />
        <div className="doc-next"><div><span>SIGUIENTE</span><h3>¿Preferís una definición declarativa?</h3><p>Creá el mismo contrato sin handlers TypeScript y compilalo al mismo manifiesto.</p></div><a href="/documentacion/markdown">Leer agentes Markdown <span aria-hidden="true">→</span></a></div>
      </section>
      </DocumentationShell>
    </>
  );
}
