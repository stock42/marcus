# Tool Runtime y catálogo oficial

Las tools administradas son capacidades versionadas que un agente invoca a
través de `context.tools`. No son imports directos ni helpers sin gobierno: cada
llamada cruza el Runtime Host, llega a `marcusd`, se valida contra la allowlist
de la `AgentVersion`, aplica su política operativa y deja evidencia durable.

## Modelo de seguridad y versionado

Cada entrada de la allowlist se guarda dentro del manifiesto inmutable
`marcus.agent/v1` con estos campos:

| Campo | Significado |
| --- | --- |
| `id` | Nombre estable de la tool. El namespace `marcus/` está reservado. |
| `version` | Versión oficial o hash del descriptor de una `defineTool`. |
| `source` | `marcus` para el catálogo oficial; `agent` para una implementación incluida en el artifact. |
| `inputSchema` / `outputSchema` | Contratos JSON serializables, validados antes y después de ejecutar. |
| `timeoutMs` | Límite superior; una llamada puede pedir un timeout menor, nunca ampliarlo. |
| `cancellable` | Declara si la implementación coopera con `AbortSignal`. |
| `sideEffects` | Indica si puede modificar estado o producir efectos externos. |
| `risk` | `low`, `medium`, `high` o `critical`. |
| `idempotency` | `none`, `input-hash` o `caller-key`, con scope por Run o AgentVersion. |

La allowlist es obligatoria. Que una tool exista en el catálogo no autoriza a
cualquier agente a usarla. La tool debe estar declarada en la versión exacta que
está ejecutando el Run; de lo contrario Marcus responde `TOOL_NOT_ALLOWED`.
Actualizar tools o schemas crea una nueva AgentVersion.

## Declarar e invocar tools en TypeScript

```ts
import { defineAgent, m, tools } from "@marcus/sdk";

export default defineAgent({
  id: "daily-report",
  name: "Daily Report",
  input: m.object({ day: m.string({ format: "date" }) }),
  output: m.object({ artifactId: m.string() }),
  tools: tools.load([
    "marcus/files.list",
    "marcus/files.read",
    "marcus/artifacts.create",
  ]),
  async onRun(context, input) {
    const files = await context.tools.call<readonly { path: string }[]>(
      "marcus/files.list",
      { path: `project:/reports/${input.day}` },
    );
    const result = await context.tools.call<{ artifactId: string }>(
      "marcus/artifacts.create",
      {
        name: `${input.day}.json`,
        mediaType: "application/json",
        content: JSON.stringify(files),
      },
      { idempotencyKey: `daily-report:${input.day}` },
    );
    return result;
  },
});
```

`context.tools.call(toolId, input, options)` acepta dos opciones:

- `timeoutMs`: límite positivo menor o igual al timeout declarado;
- `idempotencyKey`: clave de negocio para tools con estrategia `caller-key`.

`cancellable: false` no significa “sin timeout”: Marcus deja de esperar cuando
vence el límite, pero no promete interrumpir una operación atómica que el
filesystem ya inició. `marcus/http.request`, `marcus/agents.invoke`,
`marcus/approvals.request` y las tools custom cooperativas sí propagan
cancelación real mediante `AbortSignal`.

Para descubrir el contrato efectivo desde el propio agente:

```ts
const allowlist = await context.tools.list();
const writeContract = await context.tools.get("marcus/files.write");
```

Fuera del runtime, el mismo discovery está disponible con:

```text
tools list
tools list daily-report
tools list daily-report --version av_...
```

```http
GET /api/v1/projects/:project/tools?agent=daily-report
GET /api/v1/projects/:project/tools?agentVersionId=av_...
```

## Declarar tools en Markdown

Markdown sólo puede allowlistear tools oficiales. Declaralas en el frontmatter:

```yaml
---
schema: marcus.agent/v1
id: support-operator
name: Support Operator
kind: prompt-task
tools:
  - marcus/files.list
  - marcus/files.read
  - marcus/events.publish
---
```

Un identificador desconocido falla la compilación con
`MD_TOOL_NOT_REGISTERED`; Marcus nunca convierte silenciosamente una referencia
en una capacidad sin contrato.

## Catálogo oficial

El catálogo actual contiene trece tools. Las once incorporadas al Tool Runtime
completo aparecen junto con `marcus/files.read` y `marcus/files.search`, que ya
formaban parte del acceso administrado a Project Files.

### `marcus/files.list`

Lista únicamente los hijos inmediatos de un directorio del Project.

```json
{ "path": "project:/agents" }
```

`path` es opcional y usa `project:/` por defecto. Devuelve un array ordenado de
metadata: `path`, `kind`, `size`, `revision`, `updatedAt` y, cuando corresponde,
`sha256` y `mediaType`. Es read-only, riesgo `low`, timeout 10 s.

### `marcus/files.stat`

Obtiene metadata actual de un archivo o directorio.

```json
{ "path": "project:/agents/support/index.ts" }
```

Recalcula metadata cuando el archivo cambió fuera de Marcus. Es read-only,
riesgo `low`, timeout 10 s.

### `marcus/files.write`

Escribe de forma atómica texto UTF-8 o bytes Base64 dentro del Project Home.

```json
{
  "path": "project:/data/report.json",
  "content": "{\"status\":\"ready\"}",
  "encoding": "utf8",
  "expectedRevision": 4,
  "mediaType": "application/json"
}
```

- `encoding` usa `utf8` por defecto; también acepta `base64`;
- `expectedRevision` implementa control optimista y evita pisar una edición
  concurrente;
- la escritura crea directorios padre y reemplaza el archivo mediante rename
  atómico;
- devuelve la nueva metadata y revisión.

Tiene efectos laterales, riesgo `high`, timeout 15 s e idempotencia
`caller-key` por AgentVersion. Para reintentos automáticos, enviá una
`idempotencyKey` estable.

### `marcus/files.move`

Mueve o renombra un archivo o directorio dentro del mismo Project.

```json
{ "from": "project:/draft/report.md", "to": "project:/reports/report.md" }
```

Devuelve `{ "from", "to", "moved": true }`. Tiene efectos laterales, riesgo
`high`, timeout 15 s e idempotencia `caller-key` por AgentVersion.

### `marcus/files.delete`

Elimina permanentemente un archivo o directorio administrado.

```json
{ "path": "project:/tmp/obsolete" }
```

Es una operación `critical`: antes de ejecutarla `marcusd` crea un Approval,
pausa el Run y exige una decisión humana explícita. Rechazar, cancelar el Run o
dejar expirar la solicitud impide la ejecución. No usa la papelera recuperable.
Tiene timeout operativo de 15 s una vez aprobada e idempotencia `caller-key`.

### `marcus/http.request`

Ejecuta una solicitud HTTP/HTTPS acotada desde el daemon.

```json
{
  "url": "https://api.example.com/v1/incidents",
  "method": "POST",
  "headers": { "content-type": "application/json" },
  "body": "{\"severity\":\"high\"}",
  "bodyEncoding": "utf8",
  "maxResponseBytes": 1048576
}
```

Admite `GET`, `HEAD`, `POST`, `PUT`, `PATCH` y `DELETE`. No acepta credenciales
embebidas en la URL, no sigue redirects, limita el request body a 1 MiB y la
respuesta a un máximo configurable de 4 MiB. Omite `set-cookie` de los headers
devueltos. Respuestas textuales usan UTF-8; las demás usan Base64. Devuelve
`status`, `statusText`, `headers`, `body`, `encoding` y `truncated`.

Es cancellable mediante `AbortSignal`, tiene efectos externos, riesgo `high`,
timeout máximo 30 s e idempotencia `caller-key`. La clave de idempotencia evita
duplicar la llamada dentro de Marcus; la API remota debe implementar su propia
semántica idempotente cuando corresponda.

### `marcus/artifacts.create`

Crea un Artifact inmutable asociado al Run actual desde contenido inline o un
Project File.

```json
{
  "name": "summary.json",
  "mediaType": "application/json",
  "content": "{\"ok\":true}",
  "encoding": "utf8",
  "visibility": "private"
}
```

Alternativa desde archivo:

```json
{
  "name": "invoice.pdf",
  "mediaType": "application/pdf",
  "projectPath": "project:/invoices/2026-08.pdf",
  "visibility": "signed"
}
```

Debe existir exactamente uno entre `content` y `projectPath`. `visibility`
acepta `private`, `public` o `signed`, y usa `private` por defecto. Devuelve
`artifactId`. Riesgo `medium`, timeout 20 s e idempotencia `caller-key`.

### `marcus/agents.invoke`

Invoca la versión activa de otro agente dentro del mismo Project y crea un Run
hijo correlacionado.

```json
{
  "agent": "incident-classifier",
  "input": { "message": "Database latency is above 2s" },
  "wait": true,
  "parentClose": "request-cancel"
}
```

`agent` acepta ID o slug. `wait` usa `true` por defecto. `parentClose` acepta
`terminate`, `request-cancel` o `detach` y define qué ocurre con el hijo cuando
el padre cierra. Riesgo `high`, timeout máximo 24 h e idempotencia `caller-key`.

### `marcus/runs.get`

Lee un Run del mismo Project por ID.

```json
{ "runId": "run_..." }
```

Devuelve estado, input/output disponibles, error, trazas y timestamps según el
contrato normal de Runs. No permite atravesar el límite del Project. Es
read-only, riesgo `low`, timeout 10 s.

### `marcus/events.publish`

Publica un evento durable del Project y dispara agentes activos que declaren el
topic correspondiente.

```json
{
  "topic": "orders.ready",
  "payload": { "orderId": "ord_42" }
}
```

Devuelve `eventId`, `eventSeq` y `triggeredRuns`. Tiene efectos laterales,
riesgo `high`, timeout 30 s e idempotencia `caller-key`.

### `marcus/approvals.request`

Pausa voluntariamente el Run para pedir una decisión humana.

```json
{
  "action": "send-customer-notification",
  "prompt": "¿Autorizar el envío al cliente acme@example.com?",
  "data": { "customerId": "cus_42", "template": "incident-update" }
}
```

La respuesta es el objeto `resolution` enviado por quien aprueba. Un rechazo
produce `APPROVAL_REJECTED`; la solicitud expira después de 24 h y la
cancelación del Run la marca `cancelled`. Riesgo `medium` y timeout máximo 24 h.

### `marcus/files.read`

Lee un archivo y devuelve `{ "data": "...", "encoding": "base64" }`. El
contenido siempre viaja en Base64 para conservar bytes exactos. Es read-only,
riesgo `low`, timeout 10 s.

### `marcus/files.search`

Busca texto sin distinguir mayúsculas dentro de Project Files.

```json
{ "query": "incident", "path": "project:/agents" }
```

`path` es opcional. Devuelve coincidencias con `path`, `line` y `text`. Es
read-only, riesgo `low`, timeout 15 s.

## `defineTool`: tools propias versionadas

Una implementación custom vive dentro del artifact del agente, pero su
descriptor completo queda fijado en la AgentVersion y su ejecución sigue
pasando por el gobierno del daemon.

```ts
import { defineAgent, defineTool, m } from "@marcus/sdk";

const normalizeCustomer = defineTool({
  id: "normalize-customer",
  description: "Normaliza el nombre y email de un cliente.",
  input: m.object({ name: m.string(), email: m.string({ format: "email" }) }),
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
});

export default defineAgent({
  id: "customer-import",
  name: "Customer Import",
  input: m.object({ name: m.string(), email: m.string() }),
  output: normalizeCustomer.output,
  tools: [normalizeCustomer],
  async onRun(context, input) {
    return context.tools.call("normalize-customer", input);
  },
});
```

El SDK calcula `version` como SHA-256 del descriptor estable. Cambiar schemas,
timeout, riesgo o idempotencia cambia esa versión. El namespace `marcus/` no
puede usarse en `defineTool`.

## Auditoría, replay y estados

Cada llamada real o replay crea un registro `tool_calls` con Run, AgentVersion,
tool/version, estado, riesgo, efectos laterales, timestamps, Approval asociado y
origen de cache cuando existe. Marcus además publica eventos Kernel
`tool.requested`, `tool.waiting_for_approval`, `tool.completed`, `tool.failed` o
`tool.replayed`, y agrega una entrada `tools.call` al audit log.

Las estrategias de idempotencia funcionan así:

- `none`: cada llamada ejecuta;
- `input-hash`: Marcus deriva una clave del input JSON canónico;
- `caller-key`: sólo deduplica cuando el agente envía `idempotencyKey`;
- scope `run`: deduplica dentro del Run;
- scope `agent-version`: deduplica entre Runs de la misma versión.

Una llamada equivalente `completed` devuelve el output persistido con
`idempotentReplay: true`. Si la original sigue `running` o
`waiting_for_approval`, Marcus responde `TOOL_IDEMPOTENCY_IN_PROGRESS`.

## Errores operativos

| Código | Causa |
| --- | --- |
| `TOOL_NOT_ALLOWED` | La AgentVersion no incluyó la tool en su allowlist. |
| `TOOL_MANIFEST_INVALID` | Un manifiesto antiguo o corrupto no contiene un descriptor resoluble. |
| `TOOL_INPUT_INVALID` | El input no satisface `inputSchema`. |
| `TOOL_OUTPUT_INVALID` | La implementación devolvió un valor fuera de `outputSchema`. |
| `TOOL_TIMEOUT` | Se alcanzó el timeout efectivo. |
| `TOOL_CANCELLED` | El Run o la llamada fue cancelada. |
| `TOOL_IDEMPOTENCY_IN_PROGRESS` | Ya hay una llamada equivalente no terminal. |
| `APPROVAL_REJECTED` | Una operación crítica o aprobación explícita fue rechazada. |

No registres secretos en inputs de tools custom. Marcus redacta nombres de
campos sensibles y contenido de escritura en la evidencia de auditoría, pero la
tool debe diseñarse para recibir referencias de secretos y resolverlas mediante
`context.secrets` cuando sea posible.
