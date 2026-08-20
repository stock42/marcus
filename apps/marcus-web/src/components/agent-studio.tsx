"use client";

import {
  STUDIO_IDEMPOTENCY_HEADER,
  STUDIO_PROTOCOL,
  STUDIO_REQUEST_ID_HEADER,
  isStudioServerEvent,
  type StudioFormat,
  type StudioGeneratedOutput,
  type StudioQuota,
  type StudioRequestId,
  type StudioServerEvent,
  type StudioStage,
} from "@marcus/studio-contracts";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const EXAMPLES = [
  { label: "Recomendador de películas", prompt: "Quiero un agente al que le paso una lista de películas que me gustaron y me devuelve recomendaciones explicando por qué encajan conmigo." },
  { label: "Clasificador de correos", prompt: "Quiero un agente que clasifique correos por urgencia y categoría, explique su decisión y proponga el próximo paso." },
  { label: "Resumen de soporte", prompt: "Quiero un agente que resuma una consulta de soporte, identifique los datos faltantes y recomiende el próximo paso operativo." },
  { label: "Planificador de comidas", prompt: "Quiero un agente que reciba restricciones alimentarias simples y arme un plan de comidas de cinco días con ingredientes." },
] as const;

const STAGE_ORDER: readonly StudioStage[] = [
  "request-accepted",
  "quota-reserved",
  "provider-connecting",
  "provider-thinking",
  "provider-answering",
  "marcus-validating",
  "completed",
];

const STAGE_LABELS: Record<StudioStage, string> = {
  "request-accepted": "Solicitud aceptada",
  "quota-reserved": "Cuota reservada",
  "provider-connecting": "Conexión con DeepSeek",
  "provider-thinking": "Thinking Mode activo",
  "provider-answering": "Construcción de la fuente",
  "marcus-validating": "Validación Marcus",
  completed: "Versión lista",
};

type ConnectionState = "connecting" | "ready" | "reconnecting" | "offline";
type Activity = { stage: StudioStage; message: string; emittedAt: string };
type StudioVersion = {
  number: number;
  requestId: StudioRequestId;
  output: StudioGeneratedOutput;
  instruction: string;
  rootBrief: string;
  createdAt: string;
};

type PendingGeneration = {
  requestId: StudioRequestId;
  instruction: string;
  rootBrief: string;
  versionNumber: number;
};

export function AgentStudio() {
  const [format, setFormat] = useState<StudioFormat>("markdown");
  const [prompt, setPrompt] = useState<string>(EXAMPLES[0].prompt);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [quota, setQuota] = useState<StudioQuota>({ limit: 10, remaining: 10, windowMs: 60_000, retryAfterMs: 0 });
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [model, setModel] = useState("deepseek-v4-flash");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [versions, setVersions] = useState<StudioVersion[]>([]);
  const [currentVersionNumber, setCurrentVersionNumber] = useState<number>();
  const [activeRequestId, setActiveRequestId] = useState<StudioRequestId>();
  const [failure, setFailure] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [compare, setCompare] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const stoppedRef = useRef(false);
  const activeRequestRef = useRef<StudioRequestId | undefined>(undefined);
  const pendingRef = useRef<PendingGeneration | undefined>(undefined);
  const lastSequenceRef = useRef(new Map<StudioRequestId, number>());

  const formatVersions = useMemo(
    () => versions.filter((version) => version.output.format === format).sort((left, right) => left.number - right.number),
    [format, versions],
  );
  const currentVersion = formatVersions.find((version) => version.number === currentVersionNumber) ?? formatVersions.at(-1);
  const previousVersion = currentVersion === undefined
    ? undefined
    : formatVersions.filter((version) => version.number < currentVersion.number).at(-1);

  useEffect(() => {
    stoppedRef.current = false;
    const requestedFormat = new URLSearchParams(window.location.search).get("format");
    const formatTimer = requestedFormat === "markdown" || requestedFormat === "typescript"
      ? setTimeout(() => setFormat(requestedFormat), 0)
      : undefined;
    void readVersions()
      .then((stored) => {
        if (stoppedRef.current) return;
        setVersions(stored);
        setCurrentVersionNumber(stored.at(-1)?.number);
      })
      .catch(() => undefined)
      .finally(() => { if (!stoppedRef.current) setHistoryLoaded(true); });
    let retry: ReturnType<typeof setTimeout> | undefined;

    const receive = (event: StudioServerEvent) => {
      if (event.type === "session.ready") {
        setConnection("ready");
        setQuota(event.data.quota);
        setRetrySeconds(Math.ceil(event.data.quota.retryAfterMs / 1_000));
        setModel(event.data.model);
        const active = activeRequestRef.current;
        if (active !== undefined) {
          socketRef.current?.send(JSON.stringify({ protocol: STUDIO_PROTOCOL, type: "resume", requestId: active, afterSequence: lastSequenceRef.current.get(active) ?? 0 }));
        }
        return;
      }
      if (event.requestId === undefined || event.requestId !== activeRequestRef.current) return;
      const last = lastSequenceRef.current.get(event.requestId) ?? 0;
      if (event.sequence > 0 && event.sequence <= last) return;
      if (event.sequence > 0) lastSequenceRef.current.set(event.requestId, event.sequence);
      if (event.type === "quota.updated" || event.type === "generation.rate_limited") {
        setQuota(event.data.quota);
        setRetrySeconds(Math.ceil(event.data.quota.retryAfterMs / 1_000));
      }
      if (event.type === "generation.stage") {
        setActivities((current) => [...current.filter((item) => item.stage !== event.data.stage), { stage: event.data.stage, message: event.data.message, emittedAt: event.emittedAt }]);
      }
      if (event.type === "generation.completed") {
        const pending = pendingRef.current;
        if (pending === undefined) return;
        const created: StudioVersion = {
          number: pending.versionNumber,
          requestId: event.requestId,
          output: event.data.output,
          instruction: pending.instruction,
          rootBrief: pending.rootBrief,
          createdAt: event.emittedAt,
        };
        setVersions((current) => current.some((version) => version.requestId === created.requestId) ? current : [...current, created]);
        setCurrentVersionNumber(created.number);
        setActivities((current) => [...current.filter((item) => item.stage !== "completed"), { stage: "completed", message: event.data.output.validationLabel, emittedAt: event.emittedAt }]);
        setActiveRequestId(undefined);
        activeRequestRef.current = undefined;
        pendingRef.current = undefined;
        setPrompt("");
      }
      if (event.type === "generation.failed") {
        setFailure(`${event.data.message}${event.data.retryable ? " Podés reintentar sin perder tu trabajo." : ""}`);
        setActiveRequestId(undefined);
        activeRequestRef.current = undefined;
        pendingRef.current = undefined;
      }
    };

    const connect = async (newSession: boolean) => {
      try {
        const base = studioHttpBase();
        if (newSession) {
          const session = await fetch(`${base}/api/studio/sessions`, { method: "POST", credentials: "include" });
          if (!session.ok) throw new Error("No fue posible iniciar la sesión pública.");
        }
        const socket = new WebSocket(`${base.replace(/^http/u, "ws")}/api/studio/ws`);
        socketRef.current = socket;
        socket.addEventListener("message", (message) => {
          let value: unknown;
          try { value = JSON.parse(String(message.data)); }
          catch { return; }
          if (isStudioServerEvent(value)) receive(value);
        });
        socket.addEventListener("close", (event) => {
          if (stoppedRef.current) return;
          setConnection("reconnecting");
          retry = setTimeout(() => { void connect(event.code === 4001); }, 900);
        });
        socket.addEventListener("error", () => setConnection("offline"));
      } catch (error) {
        if (stoppedRef.current) return;
        setConnection("offline");
        setFailure(error instanceof Error ? error.message : "Agent Studio no está disponible.");
        retry = setTimeout(() => { setConnection("reconnecting"); void connect(true); }, 2_000);
      }
    };
    void connect(true);
    return () => {
      stoppedRef.current = true;
      if (formatTimer !== undefined) clearTimeout(formatTimer);
      if (retry !== undefined) clearTimeout(retry);
      socketRef.current?.close(1000, "Page closed");
    };
  }, []);

  useEffect(() => {
    if (historyLoaded) void writeVersions(versions).catch(() => undefined);
  }, [historyLoaded, versions]);
  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = setTimeout(() => setRetrySeconds((value) => Math.max(0, value - 1)), 1_000);
    return () => clearTimeout(timer);
  }, [retrySeconds]);
  const generate = async () => {
    const instruction = prompt.trim();
    if (instruction.length < 12 || activeRequestId !== undefined) return;
    if (connection !== "ready" || socketRef.current?.readyState !== WebSocket.OPEN) {
      setFailure("La conexión en tiempo real todavía no está lista.");
      return;
    }
    const requestId = `streq_${crypto.randomUUID().replaceAll("-", "")}` as StudioRequestId;
    const idempotencyKey = `idem-${crypto.randomUUID()}`;
    const rootBrief = currentVersion?.rootBrief ?? instruction;
    pendingRef.current = { requestId, instruction, rootBrief, versionNumber: nextVersionNumber(versions) };
    activeRequestRef.current = requestId;
    lastSequenceRef.current.set(requestId, 0);
    setActiveRequestId(requestId);
    setFailure(undefined);
    setActivities([]);
    setCompare(false);
    const body = {
      requestId,
      idempotencyKey,
      format,
      prompt: currentVersion === undefined ? instruction : refinementPrompt(rootBrief, instruction),
      ...(currentVersion === undefined ? {} : {
        baseVersion: { number: currentVersion.number, filename: currentVersion.output.filename, source: currentVersion.output.source },
      }),
    };
    try {
      const response = await fetch(`${studioHttpBase()}/api/studio/requests`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          [STUDIO_REQUEST_ID_HEADER]: requestId,
          [STUDIO_IDEMPOTENCY_HEADER]: idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      if (response.status !== 202) throw new Error(`El gateway rechazó el transporte HTTP (${response.status}).`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "No fue posible enviar la solicitud.");
      setActiveRequestId(undefined);
      activeRequestRef.current = undefined;
      pendingRef.current = undefined;
    }
  };

  const cancel = () => {
    if (activeRequestId === undefined) return;
    socketRef.current?.send(JSON.stringify({ protocol: STUDIO_PROTOCOL, type: "generation.cancel", requestId: activeRequestId }));
  };

  const copySource = async () => {
    if (currentVersion === undefined) return;
    try {
      await navigator.clipboard.writeText(currentVersion.output.source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setFailure("El navegador no permitió copiar automáticamente. Seleccioná la fuente desde el visor.");
    }
  };

  const downloadSource = () => {
    if (currentVersion === undefined) return;
    const url = URL.createObjectURL(new Blob([currentVersion.output.source], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = currentVersion.output.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const busy = activeRequestId !== undefined;
  const stageIndex = activities.length === 0 ? -1 : Math.max(...activities.map((activity) => STAGE_ORDER.indexOf(activity.stage)));
  const activeStage = busy ? STAGE_ORDER[Math.min(stageIndex + 1, STAGE_ORDER.length - 1)] : undefined;

  return (
    <div className="studio-page">
      <a className="skip-link" href="#studio-workbench">Saltar al workspace</a>
      <header className="studio-appbar">
        <Link className="brand studio-brand" href="/" aria-label="Marcus, volver al sitio">
          <span className="brand__mark" aria-hidden="true" />
          <span>Marcus</span>
        </Link>
        <div className="studio-appbar__context">
          <span aria-hidden="true">/</span>
          <h1>Agent Studio</h1>
          <small>Laboratorio público</small>
        </div>
        <nav className="studio-appbar__nav" aria-label="Navegación de Agent Studio">
          <Link href="/documentacion">Documentación</Link>
          <Link href="/">Salir al sitio</Link>
        </nav>
        <ConnectionBadge state={connection} />
      </header>

      <main className="studio-shell" id="studio-workbench">
        <section className="studio-editor-grid" aria-label="Editor de agentes">
          <article className="studio-pane studio-composer" aria-labelledby="studio-brief-title">
            <header className="studio-pane__header">
              <div><span>BRIEF.AGENT</span><h2 id="studio-brief-title">{currentVersion === undefined ? "Diseñá el agente" : "Pedile un ajuste"}</h2></div>
              <span className="studio-pane__step">01</span>
            </header>
            <p className="studio-composer__intro">Describí el objetivo en lenguaje natural. Marcus devuelve una fuente portable sin ejecutarla ni desplegarla.</p>
          <div className="studio-format" role="group" aria-label="Formato de salida">
            <button type="button" className={format === "markdown" ? "is-active" : ""} aria-pressed={format === "markdown"} disabled={busy} onClick={() => setFormat("markdown")}>Markdown</button>
            <button type="button" className={format === "typescript" ? "is-active" : ""} aria-pressed={format === "typescript"} disabled={busy} onClick={() => setFormat("typescript")}>TypeScript SDK</button>
          </div>
            <div className="studio-examples" aria-label="Ejemplos para empezar">
              {EXAMPLES.map((example) => <button key={example.label} type="button" disabled={busy} onClick={() => setPrompt(example.prompt)}>{example.label}<span aria-hidden="true">↗</span></button>)}
            </div>
            <label className="studio-field" htmlFor="studio-brief">
              <span>{currentVersion === undefined ? "¿Qué tiene que hacer?" : `Ajuste sobre v${currentVersion.number}`}</span>
              <textarea id="studio-brief" value={prompt} maxLength={4_000} disabled={busy} placeholder={currentVersion === undefined ? "Quiero un agente que…" : "Agregá, eliminá o precisá…"} onChange={(event) => setPrompt(event.target.value)} />
              <small>{prompt.length.toLocaleString("es-AR")} / 4.000 caracteres</small>
            </label>
            {failure !== undefined && <div className="studio-error" role="alert"><strong>No se pudo completar</strong><p>{failure}</p></div>}
            <div className="studio-composer__actions">
              <button className="studio-primary" type="button" disabled={busy || prompt.trim().length < 12 || connection !== "ready"} onClick={() => void generate()}>{busy ? "Generando agente…" : currentVersion === undefined ? "Generar agente" : "Crear nueva versión"}<span aria-hidden="true">→</span></button>
              {busy && <button className="studio-secondary" type="button" onClick={cancel}>Cancelar</button>}
            </div>
            {formatVersions.length > 0 && (
              <details className="studio-history">
                <summary>Historial local <span>{formatVersions.length} {formatVersions.length === 1 ? "versión" : "versiones"}</span></summary>
                <ol>{[...formatVersions].reverse().map((version) => <li key={version.requestId} className={version.number === currentVersion?.number ? "is-current" : ""}><div><strong>v{version.number} · {version.output.name}</strong><span>{version.instruction}</span></div><time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString("es-AR")}</time><button type="button" onClick={() => { setCurrentVersionNumber(version.number); setCompare(false); }}>Restaurar</button></li>)}</ol>
              </details>
            )}
            <p className="studio-disclaimer">No envíes secretos ni datos personales. El historial sólo vive en este navegador.</p>
          </article>

          <article className="studio-pane studio-source" aria-labelledby="source-title">
            <header className="studio-source__tabs">
              <div className="studio-source__tab is-active"><span aria-hidden="true">◇</span><strong id="source-title">{currentVersion?.output.filename ?? (format === "markdown" ? "tu-agente.agent.md" : "tu-agente.ts")}</strong><i aria-hidden="true">×</i></div>
              <span className="studio-source__path">studio / output /</span>
            </header>
            <div className="studio-source__commandbar">
              <div><span className="studio-pane__eyebrow">FUENTE GENERADA</span>{currentVersion !== undefined && <span className={currentVersion.output.valid ? "studio-valid" : "studio-review"}>{currentVersion.output.valid ? "✓ Válido para Marcus" : "! Requiere revisión"}</span>}</div>
              {currentVersion !== undefined && (
                <div className="studio-source__toolbar">
                  <label><span className="sr-only">Versión</span><select aria-label="Versión" value={currentVersion.number} onChange={(event) => { setCurrentVersionNumber(Number(event.target.value)); setCompare(false); }}>{formatVersions.map((version) => <option key={version.number} value={version.number}>v{version.number} · {new Date(version.createdAt).toLocaleString("es-AR")}</option>)}</select></label>
                  <button type="button" disabled={previousVersion === undefined} onClick={() => setCompare((value) => !value)}>{compare ? "Ocultar comparación" : "Comparar"}</button>
                  <button type="button" onClick={() => void copySource()}>{copied ? "Copiado" : "Copiar"}</button>
                  <button type="button" onClick={downloadSource}>Descargar</button>
                </div>
              )}
            </div>
            <div className="studio-source__body">
              {currentVersion === undefined ? (
                <div className="studio-empty"><span aria-hidden="true">M/01</span><h3>El contrato aparecerá acá.</h3><p>Escribí el brief a la izquierda. El output validado se abrirá en este editor y la actividad real aparecerá en la terminal.</p></div>
              ) : compare && previousVersion !== undefined ? (
                <section className="studio-compare" aria-labelledby="compare-title">
                  <header><div><span>COMPARACIÓN LOCAL</span><h2 id="compare-title">v{previousVersion.number} → v{currentVersion.number}</h2></div><button type="button" onClick={() => setCompare(false)}>Cerrar comparación</button></header>
                  <div><SourceCode source={previousVersion.output.source} format={format} label={`Versión ${previousVersion.number}`} /><SourceCode source={currentVersion.output.source} format={format} label={`Versión ${currentVersion.number}`} /></div>
                </section>
              ) : <SourceCode source={currentVersion.output.source} format={format} />}
              {currentVersion !== undefined && currentVersion.output.diagnostics.length > 0 && <div className="studio-diagnostics"><strong>Diagnósticos</strong>{currentVersion.output.diagnostics.map((diagnostic, index) => <p key={`${diagnostic.code}-${index}`} className={`is-${diagnostic.severity}`}><code>{diagnostic.code}</code>{diagnostic.message}</p>)}</div>}
            </div>
          </article>
        </section>

        <section className="studio-terminal" aria-labelledby="activity-title">
          <header className="studio-terminal__header">
            <div className="studio-terminal__tabs"><h2 id="activity-title">Terminal</h2><span>Actividad</span><span>Validación</span></div>
            <div className="studio-terminal__meta"><span><i className="studio-pulse" aria-hidden="true" />{model}</span><span>Thinking · high</span><strong aria-label={`${quota.remaining} de ${quota.limit} solicitudes disponibles`}>{quota.remaining}/{quota.limit}</strong>{retrySeconds > 0 && <span>próximo slot en {retrySeconds}s</span>}</div>
          </header>
          <div className="studio-terminal__body" role="log" aria-live="polite" aria-label="Actividad verificable de generación">
            {activities.length === 0 && !busy && failure === undefined && <div className="studio-log-line is-muted"><time>--:--:--</time><span className="studio-log-line__scope">studio</span><strong>LISTO</strong><p>Esperando un brief. La actividad del proveedor y la validación aparecerán acá.</p></div>}
            {activities.map((activity) => <div className="studio-log-line is-done" key={`${activity.stage}-${activity.emittedAt}`}><time dateTime={activity.emittedAt}>{formatClock(activity.emittedAt)}</time><span className="studio-log-line__scope">{activity.stage.startsWith("provider") ? "deepseek" : "marcus"}</span><strong>{STAGE_LABELS[activity.stage]}</strong><p>{activity.message}</p></div>)}
            {activeStage !== undefined && !activities.some((activity) => activity.stage === activeStage) && <div className="studio-log-line is-running"><time>{formatClock(new Date().toISOString())}</time><span className="studio-log-line__scope">{activeStage.startsWith("provider") ? "deepseek" : "marcus"}</span><strong>{STAGE_LABELS[activeStage]}</strong><p>{stageHint(activeStage)}</p></div>}
            {failure !== undefined && <div className="studio-log-line is-error"><time>{formatClock(new Date().toISOString())}</time><span className="studio-log-line__scope">studio</span><strong>ERROR</strong><p>{failure}</p></div>}
          </div>
          <p className="studio-terminal__privacy">Actividad verificable. El razonamiento privado no se expone ni se almacena.</p>
        </section>

        <footer className="studio-statusbar" aria-label="Estado de Agent Studio">
          <span><i className={`is-${connection}`} aria-hidden="true" />{connectionLabel(connection)}</span>
          <span>Formato: {format === "markdown" ? "Markdown" : "TypeScript SDK"}</span>
          <span>Versiones locales: {formatVersions.length}</span>
          <span className="studio-statusbar__spacer" />
          <span>POST → WebSocket</span>
          <span>Sin deploy · Sin ejecución</span>
        </footer>
      </main>
    </div>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  return <span className={`studio-connection is-${state}`}><i aria-hidden="true" />{connectionLabel(state)}</span>;
}

function connectionLabel(state: ConnectionState): string {
  const labels: Record<ConnectionState, string> = { connecting: "Conectando", ready: "Tiempo real listo", reconnecting: "Reconectando", offline: "Sin conexión" };
  return labels[state];
}

function formatClock(value: string): string {
  return new Date(value).toLocaleTimeString("es-AR", { hour12: false });
}

function SourceCode({ source, format, label = "Fuente generada" }: { source: string; format: StudioFormat; label?: string }) {
  return <div className="studio-source__code" role="region" aria-label={label} tabIndex={0}>{source.replace(/\n$/u, "").split("\n").map((line, index) => <div className="studio-code-line" key={`${index}-${line}`}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><code>{highlightLine(line, format)}</code></div>)}</div>;
}

function highlightLine(line: string, format: StudioFormat) {
  if (format === "markdown") {
    if (/^#{1,6}\s/u.test(line)) return <><mark className="tok-heading">{line}</mark></>;
    if (/^\s*[-*]\s/u.test(line)) return <><mark className="tok-punctuation">{line.slice(0, line.indexOf(" ") + 1)}</mark>{line.slice(line.indexOf(" ") + 1)}</>;
    const key = line.match(/^(\s*)([a-z][a-z-]*)(:)(.*)$/iu);
    if (key !== null) return <>{key[1]}<mark className="tok-key">{key[2]}</mark><mark className="tok-punctuation">{key[3]}</mark>{key[4]}</>;
    if (/^```/u.test(line) || line === "---") return <mark className="tok-punctuation">{line}</mark>;
    return line;
  }
  const parts = line.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b(?:import|from|export|default|const|return|async|await|true|false)\b|\/\/.*$|\b\d+\b)/gu);
  return <>{parts.map((part, index) => {
    const className = /^['"`]/u.test(part) ? "tok-string" : /^(?:import|from|export|default|const|return|async|await|true|false)$/u.test(part) ? "tok-keyword" : /^\/\//u.test(part) ? "tok-comment" : /^\d+$/u.test(part) ? "tok-number" : undefined;
    return className === undefined ? part : <mark className={className} key={`${index}-${part}`}>{part}</mark>;
  })}</>;
}

function stageHint(stage: StudioStage): string {
  const hints: Record<StudioStage, string> = {
    "request-accepted": "Esperando una generación.",
    "quota-reserved": "Se descuenta al llamar al modelo.",
    "provider-connecting": "Canal seguro al proveedor.",
    "provider-thinking": "Razonamiento interno privado.",
    "provider-answering": "JSON estructurado en streaming.",
    "marcus-validating": "Compilación o análisis estático.",
    completed: "Archivo listo para copiar.",
  };
  return hints[stage];
}

function studioHttpBase(): string {
  if (typeof window === "undefined") return "";
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return `${window.location.protocol}//${window.location.hostname}:7447`;
  }
  return window.location.origin;
}

function nextVersionNumber(versions: readonly StudioVersion[]): number {
  return Math.max(0, ...versions.map((version) => version.number)) + 1;
}

function refinementPrompt(rootBrief: string, instruction: string): string {
  const suffix = `\n\nAjuste solicitado: ${instruction}`;
  const available = Math.max(0, 4_000 - suffix.length - "Brief original: ".length);
  return `Brief original: ${rootBrief.slice(0, available)}${suffix}`;
}

const STUDIO_DB = "marcus-agent-studio";
const STUDIO_STORE = "versions";

async function readVersions(): Promise<StudioVersion[]> {
  if (!("indexedDB" in globalThis)) return [];
  const database = await openStudioDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STUDIO_STORE, "readonly").objectStore(STUDIO_STORE).getAll();
    request.onsuccess = () => resolve((request.result as StudioVersion[]).sort((left, right) => left.number - right.number));
    request.onerror = () => reject(request.error);
  });
}

async function writeVersions(versions: readonly StudioVersion[]): Promise<void> {
  if (!("indexedDB" in globalThis)) return;
  const database = await openStudioDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STUDIO_STORE, "readwrite");
    const store = transaction.objectStore(STUDIO_STORE);
    store.clear();
    for (const version of versions) store.put(version);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function openStudioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STUDIO_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STUDIO_STORE, { keyPath: "requestId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
