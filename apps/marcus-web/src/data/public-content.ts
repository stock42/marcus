export type UseCase = {
  slug: string;
  sector: string;
  title: string;
  summary: string;
  input: string;
  capabilities: readonly string[];
  control: string;
  outcome: string;
};

export const USE_CASES: readonly UseCase[] = [
  {
    slug: "soporte",
    sector: "CX / SOPORTE",
    title: "Triage y respuesta de soporte",
    summary: "Clasifica casos, recupera contexto, propone el próximo paso y deriva excepciones sin perder la evidencia del Run.",
    input: "Ticket, historial y prioridad",
    capabilities: ["marcus/files.read", "marcus/http.request", "marcus/events.publish"],
    control: "Schemas de entrada/salida, RBAC por Project y aprobación para acciones críticas.",
    outcome: "Menor tiempo de respuesta con decisiones trazables.",
  },
  {
    slug: "operaciones",
    sector: "OPERACIONES",
    title: "Informe operativo diario",
    summary: "Consolida archivos y APIs internas, genera un artifact verificable y publica el resultado a una hora definida.",
    input: "Ventas, inventario e incidencias",
    capabilities: ["marcus/files.read", "marcus/artifacts.create", "marcus/events.publish"],
    control: "Schedule versionado, timeout, idempotencia y auditoría de cada tool call.",
    outcome: "Un reporte consistente sin trabajo manual repetitivo.",
  },
  {
    slug: "incidentes",
    sector: "SRE / PLATAFORMA",
    title: "Coordinación de incidentes",
    summary: "Consulta señales, redacta un plan de mitigación y solicita confirmación humana antes de ejecutar una operación crítica.",
    input: "Alerta, servicio afectado y contexto",
    capabilities: ["marcus/http.request", "marcus/approvals.request", "marcus/events.publish"],
    control: "Allowlist por AgentVersion, riesgo explícito, cancelación y aprobación humana durable.",
    outcome: "Respuesta más rápida sin convertir autonomía en acceso irrestricto.",
  },
  {
    slug: "documentos",
    sector: "ADMINISTRACIÓN",
    title: "Procesamiento de documentos",
    summary: "Extrae datos, aplica reglas de negocio y deja el resultado estructurado para que otro sistema continúe el flujo.",
    input: "Documentos y reglas del Project",
    capabilities: ["marcus/files.list", "marcus/files.read", "marcus/files.write"],
    control: "Contratos tipados, revisiones optimistas y archivos aislados por Project.",
    outcome: "Menos carga operativa y una salida lista para integrar.",
  },
  {
    slug: "conocimiento",
    sector: "CONOCIMIENTO INTERNO",
    title: "Asistente sobre fuentes autorizadas",
    summary: "Responde usando documentación corporativa seleccionada y diferencia con claridad datos presentes de información ausente.",
    input: "Pregunta y corpus del Project",
    capabilities: ["marcus/files.search", "marcus/files.read", "marcus/runs.get"],
    control: "Fuentes acotadas, versiones inmutables y logs redactados.",
    outcome: "Respuestas útiles sin delegar la autoridad de datos al modelo.",
  },
  {
    slug: "integraciones",
    sector: "INTEGRACIONES",
    title: "Orquestación entre sistemas",
    summary: "Recibe eventos, transforma payloads, invoca servicios existentes y encadena agentes especializados dentro del mismo gobierno.",
    input: "Evento de negocio o llamada API",
    capabilities: ["marcus/http.request", "marcus/agents.invoke", "marcus/events.publish"],
    control: "Tokens por Project, scopes, límites de concurrencia y seguimiento end-to-end.",
    outcome: "Automatización componible sin construir una plataforma paralela.",
  },
] as const;

export const ENTERPRISE_FAQS = [
  {
    question: "¿Marcus cobra por cada agente?",
    answer: "No. Marcus no agrega una tarifa por agente: una instalación puede alojar tantos agentes como permita la capacidad asignada. El cómputo, almacenamiento, red y consumo del proveedor LLM siguen siendo costos variables de la infraestructura elegida.",
  },
  {
    question: "¿Podemos empezar en un servidor local?",
    answer: "Sí. Marcus se instala en un host Linux bajo control de la empresa y mantiene su estado operativo en ~/.marcus. Es una ruta directa para validar, integrar y operar dentro de la red interna.",
  },
  {
    question: "¿Se puede desplegar en AWS?",
    answer: "Sí. La instalación puede vivir en una instancia Linux dentro de una VPC, con volumen durable, backups y un reverse proxy administrado por la organización cuando haga falta acceso remoto.",
  },
  {
    question: "¿Dónde quedan los datos y las credenciales?",
    answer: "En la infraestructura elegida por el operador. Marcus no requiere enviar el estado del Kernel a un SaaS de control; cada empresa decide proveedores de modelos, red, backups y política de exposición.",
  },
  {
    question: "¿Cómo se separan equipos o entornos?",
    answer: "Projects, usuarios, roles y tokens separan el trabajo dentro de una instalación. Para fronteras de infraestructura independientes, la arquitectura actual usa instalaciones Marcus separadas por entorno o unidad, cada una con una única autoridad.",
  },
] as const;

export const MARKDOWN_EXAMPLES = [
  {
    id: "support-triage",
    label: "SOPORTE / CONTRATO",
    title: "Resumen de un caso de soporte",
    description: "Un agente declarativo mínimo con input y output cerrados.",
    input: '{"case":"El cliente no puede ingresar desde ayer."}',
    source: `---
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
\`\`\``,
  },
  {
    id: "daily-operations",
    label: "OPERACIONES / SCHEDULE",
    title: "Informe operativo programado",
    description: "Lee fuentes del Project, crea un artifact y publica el evento de cierre cada mañana.",
    input: '{"reportDate":"2026-08-16"}',
    source: `---
schema: marcus.agent/v1
id: daily-operations
name: Daily Operations
kind: prompt-task
tools:
  - marcus/files.read
  - marcus/artifacts.create
  - marcus/events.publish
schedules:
  - id: morning-report
    cron: "0 8 * * 1-5"
    timezone: America/Argentina/Buenos_Aires
---

# Objective

Crear un informe diario breve, verificable y reutilizable.

# Prompt

Leé las fuentes operativas autorizadas, señalá anomalías, creá
el artifact del informe y publicá el evento operations.report.ready.

# Input

\`\`\`yaml schema
object:
  reportDate:
    type: string
required: [reportDate]
additional-properties: false
\`\`\`

# Output

\`\`\`yaml schema
object:
  artifactId:
    type: string
  summary:
    type: string
required: [artifactId, summary]
additional-properties: false
\`\`\``,
  },
  {
    id: "incident-control",
    label: "SRE / APROBACIÓN",
    title: "Plan de mitigación con control humano",
    description: "Investiga señales y exige una aprobación durable antes de cualquier acción crítica.",
    input: '{"service":"payments","alert":"error rate > 5%"}',
    source: `---
schema: marcus.agent/v1
id: incident-coordinator
name: Incident Coordinator
kind: prompt-task
tools:
  - marcus/http.request
  - marcus/approvals.request
  - marcus/events.publish
---

# Objective

Proponer una mitigación segura para un incidente activo.

# System

Nunca ejecutes una operación crítica sin aprobación humana.

# Prompt

Consultá las señales autorizadas, explicá la evidencia y pedí
aprobación antes de publicar el plan de mitigación.

# Input

\`\`\`yaml schema
object:
  service:
    type: string
  alert:
    type: string
required: [service, alert]
additional-properties: false
\`\`\`

# Output

\`\`\`yaml schema
object:
  approvalId:
    type: string
  plan:
    type: string
required: [approvalId, plan]
additional-properties: false
\`\`\``,
  },
] as const;

export const MCP_EXAMPLES = {
  codex: `[mcp_servers.marcus]\nurl = "http://127.0.0.1:5724/mcp"\nbearer_token_env_var = "MARCUS_MCP_TOKEN"`,
  claude: `export MARCUS_MCP_TOKEN='the-one-time-value'\nclaude mcp add --transport http marcus http://127.0.0.1:5724/mcp \\\n  --header "Authorization: Bearer $MARCUS_MCP_TOKEN"`,
  plan: `1. projects_list\n2. documentation_bundle { "bundle": "markdown" }\n3. agents_plan {\n     "projectId": "prj_...",\n     "sourceKind": "markdown",\n     "prompt": "Clasificar tickets y derivar excepciones"\n   }\n4. Mostrar el plan y esperar aprobación`,
  markdown: `agents_generate_markdown {\n  "projectId": "prj_...",\n  "prompt": "Crear un agente que clasifique tickets..."\n}\n\nagents_get      { "projectId": "prj_...", "agent": "ticket-triage" }\nagents_versions { "projectId": "prj_...", "agent": "ticket-triage" }\nagents_diff     { "projectId": "prj_...", "agent": "ticket-triage" }`,
  sdk: `documentation_bundle { "bundle": "sdk" }\nagents_plan { "projectId": "prj_...", "sourceKind": "sdk", "prompt": "..." }\nfiles_write {\n  "projectId": "prj_...",\n  "path": "project:/agents/ticket-triage/index.ts",\n  "content": "<Bun-native TypeScript>"\n}\nagents_build {\n  "projectId": "prj_...",\n  "sourcePath": "project:/agents/ticket-triage/index.ts",\n  "sourceKind": "sdk",\n  "activate": true\n}`,
} as const;
