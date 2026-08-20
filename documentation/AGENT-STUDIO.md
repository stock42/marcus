# Agent Studio público

Agent Studio convierte una necesidad escrita en español en una fuente Marcus
Markdown o TypeScript lista para copiar o descargar. La experiencia pública
vive en `https://projectmarcus.com/studio` y no requiere una cuenta.

El Studio genera y valida código. No ejecuta agentes, no crea Projects, no hace
deploy y no accede a una instalación `marcusd`.

## Recorrido

1. Elegir Markdown o TypeScript SDK.
2. Escribir un brief o seleccionar uno de los cuatro ejemplos.
3. Seguir en la terminal inferior las fases reales recibidas por WebSocket.
4. Revisar la fuente y los diagnósticos de Marcus en el editor derecho.
5. Pedir ajustes; cada respuesta crea una versión local inmutable.
6. Comparar, restaurar, copiar o descargar cualquier versión.

La ruta usa un workspace de aplicación a pantalla completa, separado del shell
de marketing. El panel izquierdo contiene el brief y el historial local; el
editor derecho mantiene la fuente activa y la comparación entre versiones; la
terminal inferior muestra en orden cronológico la actividad verificable del
gateway, DeepSeek y los validadores Marcus. En escritorio el workspace ocupa
el viewport sin scroll del documento. En pantallas pequeñas los paneles se
apilan y el documento recupera su scroll natural.

La terminal no presenta una cadena de pensamiento ni inventa llamadas de
tools: solamente muestra estados y mensajes realmente emitidos por
`marcus.studio/v1`. El razonamiento privado del proveedor no llega al browser.

El historial se guarda en IndexedDB del navegador. Restaurar no llama al LLM.
No existe una URL pública del archivo y la descarga se crea localmente con
`Blob`.

## Arquitectura

```text
Browser
  ├── GET /studio ─────────────────► marcus-web (Next.js/Bun)
  ├── POST /api/studio/requests ───► marcus-studio-gateway (Bun)
  └◄─ WS /api/studio/ws ──────────── progreso, diagnóstico y resultado
                                         │
                                         ├── DeepSeek V4 Flash
                                         ├── SQLite cifrado + rate limit
                                         └── validadores Marcus sin ejecución
```

El POST sólo inicia y correlaciona una operación. Para una sesión válida
responde `202` sin resultado funcional. Aceptación, cuota, progreso, errores,
diagnóstico y output llegan exclusivamente por WebSocket mediante
`marcus.studio/v1`; no hay polling.

El gateway escucha siempre en `127.0.0.1:7447`. En producción, Nginx publica
`/api/studio/` y mantiene el upgrade WebSocket; Next no sostiene la conexión.

## Desarrollo local

El gateway tiene su propia configuración privada en
`apps/marcus-studio-gateway/.env`. Bun la carga automáticamente porque
Turborepo ejecuta el proceso desde el workspace del gateway. El archivo real
está ignorado por Git; `.env.example` documenta las variables sin contener
secretos. No uses `.env.local`.

Prepará la configuración una sola vez:

```bash
cp apps/marcus-studio-gateway/.env.example apps/marcus-studio-gateway/.env
```

Editá `.env` y completá:

```dotenv
MARCUS_STUDIO_DEEPSEEK_API_KEY=tu_api_key_de_deepseek
```

En una terminal:

```bash
bun run dev:studio
```

En otra:

```bash
bun run web
```

Abrí [http://127.0.0.1:4321/studio](http://127.0.0.1:4321/studio). El browser
usa el gateway local en `http://127.0.0.1:7447`. Para ejecutar ambos procesos
en modo producción ya construido:

```bash
bun run studio
bun run web:production
```

## Configuración del gateway

| Variable | Default | Función |
| --- | --- | --- |
| `MARCUS_STUDIO_PORT` | `7447` | Puerto loopback del gateway. |
| `MARCUS_STUDIO_DATA_DIR` | `~/.marcus/studio` | SQLite y claves locales. |
| `MARCUS_STUDIO_DATABASE_PATH` | `<dataDir>/studio.sqlite` | Base durable de sesión, cuota y replay. |
| `MARCUS_STUDIO_ALLOWED_ORIGINS` | dominio público y loops locales | Origins exactos, separados por coma. |
| `MARCUS_STUDIO_TRUST_PROXY` | `true` | Confía en el primer `X-Forwarded-For` del proxy local. |
| `MARCUS_STUDIO_SECURE_COOKIES` | `true` en `bun run studio` | Exige HTTPS para la cookie de sesión. |
| `MARCUS_STUDIO_SESSION_TTL_MS` | `86400000` | Vida de la sesión anónima. |
| `MARCUS_STUDIO_REPLAY_TTL_MS` | `1800000` | Retención de eventos reproducibles. |
| `MARCUS_STUDIO_DEEPSEEK_API_KEY` | — | Key privada definida en `apps/marcus-studio-gateway/.env`. |
| `MARCUS_STUDIO_DEEPSEEK_API_KEY_FILE` | — | Compatibilidad opcional con un archivo de credencial externo. |
| `MARCUS_STUDIO_DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Endpoint compatible. |
| `MARCUS_STUDIO_DEEPSEEK_MODEL` | `deepseek-v4-flash` | Modelo público. |
| `MARCUS_STUDIO_PROVIDER_TIMEOUT_MS` | `90000` | Timeout del proveedor. |
| `MARCUS_STUDIO_MAX_CONCURRENT` | `8` | Circuit breaker global de concurrencia. |
| `MARCUS_STUDIO_DAILY_LLM_CALLS` | `1000` | Presupuesto diario global en llamadas. |
| `MARCUS_STUDIO_MAX_OUTPUT_TOKENS` | `8192` | Máximo solicitado al modelo. |

Cada visitante dispone de diez llamadas reales a DeepSeek por ventana móvil de
sesenta segundos. La decisión más restrictiva entre sesión e IP HMAC gana. Un
replay idempotente, una validación local rechazada, copiar, comparar, restaurar
o descargar no consumen LLM. Una cancelación posterior al fetch sí consume.

## DeepSeek y privacidad

El request canónico activa explícitamente:

```json
{
  "model": "deepseek-v4-flash",
  "stream": true,
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high",
  "response_format": { "type": "json_object" }
}
```

El adaptador separa `reasoning_content` de `content`. El navegador sólo recibe
el hito `provider-thinking`; la cadena de pensamiento no se registra, persiste
ni reproduce. Prompts y fuentes tampoco se escriben en logs. Los eventos de
replay se cifran con AES-GCM y datos asociados antes de guardarse en SQLite.

La sesión usa cookie firmada `HttpOnly`, `SameSite=Strict`, limitada a
`/api/studio`. El upgrade exige Origin exacto. No hay bearer tokens ni secretos
en query strings o estado del browser.

## Validación

- Markdown pasa por el compilador determinístico real de `@marcus/markdown` en
  memoria y debe usar `schema: marcus.agent/v1`.
- TypeScript pasa por el parser/transpiler de Bun, permite sólo `@marcus/sdk`,
  exige un export default Marcus y rechaza red, runtime globals, `eval`,
  `Function` e imports dinámicos.
- La fuente TypeScript nunca se importa o ejecuta. Un resultado válido significa
  compatibilidad estática, no que el comportamiento se haya probado.

## Reverse proxy de referencia

```nginx
location /api/studio/ws {
    proxy_pass http://127.0.0.1:7447;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /api/studio/ {
    proxy_pass http://127.0.0.1:7447;
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Definí `MARCUS_STUDIO_ALLOWED_ORIGINS` con los dominios HTTPS exactos. El
gateway y Next continúan en loopback; TLS y exposición pertenecen al proxy.

## Validación de release

```bash
bun run --filter @marcus/studio-contracts test
bun run --filter @marcus/studio-gateway test
bun run --filter @marcus/studio-gateway typecheck
bun run --filter @marcus/web test
bun run test:browser:web
bun run verify:studio-provider
```

Playwright arranca un proveedor determinista sin costo y verifica el circuito
HTTP/WebSocket, etapas, validación, dos versiones, comparación, restauración,
descarga y viewport móvil. Antes de habilitar producción debe ejecutarse además
un smoke autenticado contra la cuenta DeepSeek real para confirmar modelo,
stream, Thinking, JSON Output, usage, cancelación y errores del proveedor.
