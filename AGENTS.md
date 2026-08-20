# Directivas de trabajo de Marcus

Estas reglas son obligatorias para cualquier tarea en este monorepo. Un
`AGENTS.md` anidado puede agregar restricciones para su subárbol, pero no puede
debilitar las reglas de este archivo.

## Flujo Git obligatorio

1. Leer este archivo completo antes de actuar.
2. Ejecutar `git status --short --branch` y preservar cualquier trabajo ajeno o
   no relacionado.
3. Antes de modificar cualquier archivo, ejecutar `git pull --ff-only`. Si la
   rama todavía no tiene upstream, usar explícitamente el remoto y la rama
   correctos. Si no existe una referencia remota o el pull falla, informar el
   estado exacto; nunca resolverlo reescribiendo historia, descartando cambios
   ni alterando credenciales.
4. Implementar exclusivamente el alcance solicitado.
5. Ejecutar validaciones proporcionales al cambio.
6. Ejecutar `bun run package:changed` cuando el cambio alcance una superficie
   empaquetable. El gate debe completar sin errores antes del commit.
7. Actualizar `/CHANGELOG.md` en el mismo conjunto de cambios.
8. Revisar el diff completo y crear un commit intencional. Una tarea con cambios
   propios sin commit no está terminada.
9. Repetir `bun run package:changed --base HEAD^` después del commit cuando éste
   contenga superficies empaquetables. Los manifests finales deben identificar
   el commit recién creado; un fallo bloquea el push.
10. Trabajar directamente en la rama local `main`, que rastrea `origin/main`, y
   ejecutar `git push origin main` después de cada commit. La tarea no está
   terminada hasta que ambas ramas queden sincronizadas.

El push de commits a `origin/main` es obligatorio. Publicar paquetes, crear tags
o desplegar requiere un pedido explícito. Nunca usar operaciones Git
destructivas sobre trabajo existente.

## Fuente de verdad

- La fuente de verdad actual es el código ejecutable, sus manifests, tests,
  tooling y archivos de distribución.
- `private/docs/` contiene specs y planes de trabajo privados. Todo
  `private/` debe permanecer fuera de Git mediante `.gitignore`; nunca
  agregarlo al índice, publicarlo ni usarlo
  como documentación para usuarios.
- `documentation/` contiene la documentación versionada para usuarios,
  integradores, operadores y contribuidores. Actualizar la parte afectada
  cuando cambien interfaces, comportamiento, configuración u operación.
- `README.md` ofrece una introducción, pero ante divergencias prevalecen el
  código, los tests y la configuración efectiva.
- `CHANGELOG.md` vive únicamente en la raíz y registra cada cambio relevante.

## Alcance y seguridad

- Nunca crear archivos `.env.local`.
- Respetar el mecanismo de configuración existente: archivos JSON explícitos,
  argumentos CLI y variables de entorno ya soportadas.
- No ampliar el alcance con refactors, abstracciones, dependencias o
  protecciones no solicitadas.
- Proponer mejoras, riesgos y oportunidades —especialmente de seguridad— y
  esperar aprobación explícita antes de implementarlos.
- Nunca inspeccionar, imprimir, copiar, cambiar ni persistir credenciales. No
  registrar passwords, tokens, cookies, claves, headers de autorización ni URLs
  con credenciales.
- No crear procesos persistentes salvo pedido explícito. Los procesos temporales
  de validación deben finalizar y limpiar sus recursos.
- No borrar datos, repositorios, configuración o artefactos del usuario sin una
  autorización inequívoca y un destino exacto.

## Producto y arquitectura

Marcus es un sistema operativo agéntico Bun-first. La autoridad es `marcusd`;
los clientes se comunican con ella mediante MNP/1.

```text
marcus CLI ── MNP/1 ──┐
                      ├── marcusd ── Kernel ── Runtime Hosts
marcus-api ── MNP/1 ──┘
     │
     └── REST/WebSocket + Backoffice
```

- `marcusd` es la única autoridad de estado, autenticación, autorización,
  scheduling, ejecución y persistencia.
- `marcus-api` adapta HTTP/WebSocket a MNP/1; no accede directamente al Kernel
  ni a SQLite.
- `marcus` es el cliente CLI interactivo y one-shot de MNP/1.
- El Backoffice consume exclusivamente la frontera HTTP/WebSocket.
- Los Runtime Hosts ejecutan artefactos TypeScript en Worker o proceso dedicado,
  según el perfil de runtime.
- SQLite mediante `bun:sqlite` es la persistencia autoritativa local.

## Bun-first y TypeScript

- Runtime, package manager y test runner: Bun. La versión base declarada es
  `bun@1.3.14` y el lockfile único es `bun.lock`.
- El código de servidor, CLI y packages se ejecuta directamente desde
  TypeScript. `tsc` se usa con `noEmit` sólo para validación de tipos.
- Regla absoluta: no crear, mantener ni configurar un directorio `dist/` en
  ninguna parte versionable del monorepo, incluida la parte web. Next.js usa
  únicamente su salida nativa ignorada `.next/`.
- El runtime Bun ejecuta TypeScript/JSX directamente. El navegador no ejecuta
  TypeScript/JSX fuente; ambas aplicaciones Next usan exclusivamente su cache y
  salida nativa ignorada `.next/`, nunca `build/` ni `dist/` versionables.
- No generar JavaScript transpileado por package ni declaraciones duplicadas.
- Los packages exportan `src/*.ts` de forma nativa. El SDK publicado se arma en
  staging temporal con TypeScript autocontenido.
- `build` produce la salida nativa `.next/` del Backoffice y del website. Los
  packages Bun-native no transpilan su fuente.
- `bun build --compile` se reserva para ejecutables standalone de distribución;
  no forma parte del contrato de desarrollo de los packages.
- Para leer contenido completo usar `Bun.file(path).text()`, `.json()` o
  `.arrayBuffer()`. Usar `node:fs`/`node:fs/promises` cuando se necesitan
  primitivas de filesystem como `mkdir`, `open`, `stat`, `readdir`, `rename`,
  `rm`, streams o permisos.
- Usar `Bun.write`, `Bun.spawn`, `Bun.CryptoHasher`, `Bun.password`,
  `Bun.listen`, `Bun.connect` y `bun:sqlite` donde corresponda al runtime.
- No introducir npm, pnpm, Yarn, Jest u otro toolchain paralelo.

## Estructura del monorepo

El workspace contiene 7 aplicaciones y 17 packages. Las skills vendorizadas y
su lock son herramientas privadas de desarrollo conservadas bajo `private/`;
no forman parte del repositorio público ni del producto distribuido.

### Aplicaciones

- `apps/marcusd`: daemon y autoridad MNP/1. Carga configuración, mantiene el
  lock de autoridad, abre SQLite, inicia Kernel/scheduler/runtimes y soporta
  backup, verificación y restore offline. Por defecto escucha sólo en
  `127.0.0.1:4242`, unifica el estado personal bajo `~/.marcus/` y administra
  allí `api.token` para la conexión interna de la API. Los releases detectan
  sus ejecutables internos desde el directorio o prefijo de instalación.
- `apps/marcus-api`: API REST/WebSocket sobre `s42-core@3.0.13`. Traduce cada
  ruta explícita a una operación MNP/1 y no contiene ni sirve el Backoffice. En
  el flujo personal descubre el token interno sin configuración manual. El
  listener HTTP está fijado a `127.0.0.1`; la exposición externa pertenece a un
  reverse proxy administrado por el operador.
- `apps/marcus-cli`: ejecutable `marcus`, con REPL y modo `--command`. Las
  credenciales sólo entran por canales explícitos como stdin, archivo de token
  o variables de entorno configuradas por perfil.
- `apps/marcus-backoffice`: Backoffice Next.js App Router ejecutado por Bun.
  Usa Server Components para lecturas directas a Marcus API y Route
  Handlers BFF explícitos para sesión y mutaciones de UI. El catálogo shadcn
  vive como código fuente dentro de la app. No contiene un proxy REST catch-all
  ni recibe credenciales internas capaces de omitir RBAC o CSRF.
- `apps/marcus-web`: aplicación Next.js App Router pública en español para
  `projectmarcus.com`, ejecutada por Bun. El recorrido de consola se hidrata
  desde JSON y sus comandos Marcus se validan contra el parser real del CLI.
  `bun run web` la sirve en `127.0.0.1:4321` para desarrollo.
- `apps/marcus-studio-gateway`: gateway Bun público y dedicado de Agent Studio.
  Acepta generaciones por HTTP POST, entrega progreso y resultados sólo por
  WebSocket, aplica cuota durable y valida la fuente sin ejecutarla. Escucha en
  `127.0.0.1:7447`; `bun run dev:studio` inicia desarrollo y `bun run studio`
  inicia el proceso de producción. Su configuración privada vive en el `.env`
  ignorado del propio workspace; `.env.example` conserva el contrato sin
  secretos y no debe reemplazarse por `.env.local`.
- `apps/integration-tests`: escenarios end-to-end MNP/Kernel/Runtime/SQLite.

### Packages

- `packages/contracts`: tipos, identificadores, errores y contratos base sin
  dependencias internas.
- `packages/schema`: DSL de schemas serializables y validación de inputs.
- `packages/sdk`: API de autoría `defineAgent`, PromptTask, Assistant,
  AuthValidator y harness de testing.
- `packages/protocol`: framing, preface y envelopes binarios de MNP/1.
- `packages/protocol-client`: cliente TCP/TLS Bun para MNP/1.
- `packages/cli`: parser seguro, comandos, contexto de proyecto y REPL.
- `packages/compiler`: carga y compilación de agentes SDK y validadores.
- `packages/markdown`: parser YAML/Markdown y compilación determinística de
  agentes declarativos.
- `packages/kernel`: ciclo de vida de Runs, concurrencia, rate limits,
  scheduling, state machines y registro de procesos.
- `packages/storage-sqlite`: conexión, migraciones y repositorios durables.
- `packages/service`: daemon, autenticación, autorización, router MNP,
  operaciones, scheduler y backup/restore.
- `packages/runtime-host`: aislamiento y supervisión por Worker o proceso.
- `packages/project-files`: resolución segura de paths lógicos, escritura
  atómica, revisiones, trash, sync y artifacts.
- `packages/secrets`: secretos cifrados con AES-GCM y master key externa.
- `packages/provider-contracts`: adaptadores y capacidades de proveedores,
  incluido el contrato OpenAI-compatible.
- `packages/observability`: eventos, contexto de trazas y redacción recursiva de
  información sensible.
- `packages/studio-contracts`: protocolo público, eventos WebSocket, límites y
  contratos compartidos entre Agent Studio y su gateway.

## Límites de dependencias

- Todo código desplegable vive en `apps/*`; el código compartido vive en
  `packages/*`.
- Una app no importa código fuente de otra app.
- `@marcus/contracts` no depende de ningún otro workspace.
- `@marcus/sdk` sólo puede depender internamente de contracts y schema; el
  package público declara los tipos de Bun como peer de desarrollo.
- CLI y API no pueden importar Kernel ni storage directamente.
- `s42-core` está confinado a `@marcus/api`.
- Una dependencia runtime externa requiere una decisión arquitectónica
  explícita; las excepciones vigentes son `s42-core` en la API, Next.js/React
  en las dos aplicaciones web, shadcn en `@marcus/backoffice` y el compilador
  `typescript` confinado al typecheck virtual no ejecutable del Studio gateway.
- No introducir ciclos entre workspaces.
- Ejecutar `bun run verify:boundaries` cuando cambien imports, manifests o
  límites de packages.

## API y S42-Core

- La estructura canónica es `apps/marcus-api/src/modules/<capability>/`.
- Cada módulo declara `__module__.ts` y controladores separados en
  `controllers/*.ts`.
- Las rutas son explícitas; no crear catch-all `/api/v1/*` ni routing paralelo
  fuera de S42-Core.
- Cada controlador define su método, path y mapeo a la operación/payload MNP.
- `Modules.load()` es el mecanismo de descubrimiento en modo fuente.
- El ejecutable compilado usa el registro estático de `modules/bundled.ts`
  porque el filesystem embebido no admite el mismo descubrimiento dinámico.
- `Dependencies` expone la instancia de `MarcusApi` a los controladores.
- HTTP usa `RouteControllers`; WebSocket usa `WebSocketControllers`. La API no
  sirve assets del Backoffice.
- Mantener paridad entre el descubrimiento dinámico y el registro compilado.
  Actualmente existen 27 módulos y 101 controladores HTTP explícitos.
- Las políticas de autenticación, autorización, CSRF, CORS y entrypoints se
  aplican en la frontera API/daemon, nunca sólo en la interfaz.

## Persistencia y seguridad de runtime

- Toda evolución de SQLite se agrega como una migración nueva y ordenada; no se
  reescribe una migración ya aplicada.
- Mantener foreign keys, busy timeout, WAL para bases persistentes y
  transacciones para invariantes multi-write.
- Las versiones de agentes y AuthValidators son inmutables; la activación se
  registra por separado.
- La protección antireplay HMAC es durable en `hmac_replay_entries`: se guarda
  sólo el fingerprint hash por Project hasta que vence la ventana. Un reinicio
  no puede reabrir una firma aceptada.
- Los secretos se cifran con AES-GCM, asociados al nombre y Project. La master
  key no debe guardarse en la base ni incluirse en backups normales.
- Los paths de Project deben pasar por `ProjectPathResolver`; bloquear traversal
  y symlinks que escapen del Project Home.
- La RBAC se valida en cada operación del daemon. Ocultar UI nunca sustituye la
  autorización del servidor.
- Los SDK agents son código confiable del propietario; Worker/proceso aportan
  aislamiento operativo, no un sandbox para código hostil.

## Tests y validación

Comandos raíz:

```bash
bun install
bun run verify:no-dist
bun run verify:boundaries
bun run typecheck
bun run test
bun run test:browser
bun run build
bun run verify:build
bun run check
```

- `bun run check` es el gate general actualmente configurado y no depende del
  contenido privado de `private/`.
- `bun run verify:no-dist` falla si aparece un directorio `dist/` fuera de
  dependencias/caches privados o si un manifest/tsconfig lo configura como
  salida. No agregar excepciones para aplicaciones web.
- Para tests puntuales usar filtros Bun con path explícito, por ejemplo
  `bun test ./packages/service/src/daemon.test.ts`.
- Un cambio en persistencia requiere tests de migración/repositorio y el
  escenario de integración afectado.
- Un cambio en MNP requiere tests de codec/cliente/servidor y, cuando aplique,
  integración end-to-end.
- Un cambio en rutas API requiere tests de controllers, seguridad y paridad del
  registro standalone.
- Un cambio en Backoffice requiere `bun run test:browser`: Playwright carga la
  aplicación Next de producción en Chromium, falla ante
  errores de página o consola inesperados y verifica login, Projects y Files
  contra stacks daemon/API descartables.
- Un cambio en el website requiere `bun run test:browser:web`: Playwright carga
  el servidor Next de producción, comprueba `/install`, recorre los cuatro
  transcripts CLI y falla ante errores de página, consola u overflow móvil.
- Un cambio en runtime requiere cubrir Worker y proceso cuando ambos perfiles
  puedan verse afectados.
- No afirmar que una validación pasó si no se ejecutó en el checkout actual.

## Build, packaging y distribución

El empaquetado posterior a un cambio es obligatorio, no optativo. La matriz es:

- Kernel, daemon, API, CLI, protocolo, compiler, runtime, storage o cualquier
  package consumido por esos ejecutables: `bun run build:artifact` (el alias
  histórico `bun run package:release` ejecuta el mismo gate). Debe compilar
  Linux y macOS para x64 y arm64, escribir
  `apps/marcus-web/public/releases/stable/<target>/` y completar una instalación
  local real a través del mismo pipe `curl | sh` anunciado en la landing. No
  debe reconstruir la landing: los releases conservan rutas públicas estables.
- Backoffice: `bun run package:backoffice`. Debe producir el `.tgz` standalone
  específico de plataforma, extraerlo en un directorio temporal y comprobar
  que inicia con Bun y sirve su favicon únicamente en loopback.
- SDK, schema o contracts: `bun run pack` para el package Bun-native.
- Website: build Next de producción. Si cambia `/install` o su contrato de
  releases, también aplica `bun run build:artifact`.

`bun run package:changed` inspecciona el diff y ejecuta esa matriz; debe correrse
después de terminar código, documentación y changelog, y antes del commit. No
omitirlo porque ya exista un artefacto local: `artifacts/` es descartable y puede
estar obsoleto. Después del commit, repetirlo con `--base HEAD^` para regenerar
los manifests con el SHA definitivo. Un fallo de empaquetado bloquea el commit
o el push, según la etapa.

Empaquetar no equivale a publicar. Después de desplegar un release o la landing,
ejecutar `bun run verify:public-installer --full`: el gate debe descargar
`https://projectmarcus.com/install`, validar el manifest publicado y realizar
la instalación pública completa. No anunciar el circuito público como operativo
si ese comando falla.

- `bun run build` construye el Backoffice y el website. Next escribe únicamente
  los directorios ignorados `.next/` de cada aplicación.
- `bun run dev` inicia daemon y API para desarrollo. El Backoffice canónico se
  inicia con `bun run dev:backoffice` en `127.0.0.1:6636` y consume Marcus API
  en `127.0.0.1:5724` por defecto.
- `bun run api` inicia únicamente Marcus API en `127.0.0.1:5724`; el override
  explícito se pasa como `PORT=<puerto> bun run api`.
- `bun run backoffice` construye e inicia el Backoffice canónico en modo
  producción.
- `bun run web` sirve únicamente la landing pública en `127.0.0.1:4321`; puede
  cambiarse el puerto con `MARCUS_WEB_PORT` sin afectar API ni Backoffice.
- `bun run web:production` construye e inicia el website con `next start` bajo
  Bun y mantiene el listener en loopback.
- `bun run pack` empaqueta `@marcus/sdk` como TypeScript Bun-native y escribe
  los artefactos en `artifacts/packages/`.
- `bun run build:artifact` compila CLI, daemon, API y Runtime Host para
  Linux/macOS x64/arm64, publica bundles fragmentados debajo de
  `apps/marcus-web/public/releases/` y prueba el bootstrap de punta a punta
  contra un servidor HTTP descartable. No compila ni reinicia la landing;
  `bun run package:release` es su alias compatible.
- `bun run package:backoffice` construye el output standalone de Next, agrega
  sus assets estáticos, genera un `.tgz` versionado por plataforma y prueba el
  archivo ya extraído con Bun.
- `bun run build:executables` crea los ejecutables standalone del CLI y del
  conjunto servidor,
  `release-manifest.json` y `SHA256SUMS` en `artifacts/executables/<target>/`.
- Los ejecutables internos son Runtime Host, Agent Process y Manifest Loader;
  no exponerlos como comandos públicos por accidente.
- `s42-core@3.0.13` tiene un patch Bun mínimo que propaga `hostname` a
  `Bun.serve`; conservarlo mientras Marcus necesite fijar su listener loopback.
- `distribution/install.sh` valida target, protocolos, tamaños y SHA-256 antes
  del reemplazo atómico. Con `--system` crea sólo configuración faltante e
  instala y habilita exclusivamente los servicios de daemon y API. El
  Backoffice se distribuye por separado. La instalación personal unifica
  binarios públicos, ejecutables internos, configuración y estado debajo de
  `~/.marcus/`; no usar `~/.local` como prefijo implícito.
- `distribution/uninstall.sh` preserva configuración y datos por defecto; el
  purge exige confirmación exacta y nunca debe ejecutarse como validación.
- Las unidades systemd ejecutan con usuario dedicado, filesystem protegido y
  directorios de estado/runtime explícitos.
- `.next/`, `artifacts/`, `.turbo/`, bases SQLite, logs y `.marcus/` son
  artefactos generados y no deben versionarse.

## Convenciones de cambio

- Mantener ESM, TypeScript estricto, `noEmit` y exports de fuente.
- Preferir cambios pequeños y locales sobre capas ceremoniales.
- Preservar errores tipados y códigos estables en las fronteras públicas.
- No debilitar tests para hacer pasar una implementación.
- Al agregar o eliminar una ruta API, actualizar el módulo, el controller, el
  registro standalone y sus tests en el mismo cambio.
- Al agregar o renombrar un workspace, actualizar manifests, dependencias,
  tooling de límites y comandos raíz afectados.
- Al cambiar un contrato público, verificar SDK, protocolo, CLI, API,
  Backoffice e integración según las superficies consumidoras.
- Mantener `documentation/` sincronizado con toda interfaz o procedimiento
  afectado, sin copiar specs o planes privados desde `private/`.
- Registrar el resultado en `/CHANGELOG.md` antes del commit obligatorio.
