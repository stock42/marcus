import type { CSSProperties } from "react";
import { LandingExperience } from "@/components/landing-experience";
import { USE_CASES } from "@/data/public-content";
import { TERMINAL_STEPS } from "@/lib/terminal-steps";
import { SITE_DESCRIPTION, SITE_URL, SOCIAL_IMAGE } from "@/lib/site";

const initialTerminalStep = TERMINAL_STEPS[0];
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://stock42.com/#organization",
      name: "Stock42 LLC",
      url: "https://stock42.com",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "Marcus Agentic OS",
      description: SITE_DESCRIPTION,
      inLanguage: "es",
      publisher: { "@id": "https://stock42.com/#organization" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "Marcus",
      alternateName: "Marcus Agentic OS",
      url: SITE_URL,
      image: `${SITE_URL}${SOCIAL_IMAGE}`,
      description: SITE_DESCRIPTION,
      applicationCategory: "DeveloperApplication",
      applicationSubCategory: "Infraestructura para agentes de inteligencia artificial",
      operatingSystem: "Linux, macOS",
      softwareVersion: "0.1.0",
      inLanguage: "es",
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      downloadUrl: `${SITE_URL}/install`,
      author: { "@id": "https://stock42.com/#organization" },
      publisher: { "@id": "https://stock42.com/#organization" },
      featureList: [
        "Agentes de IA versionados",
        "Ejecución supervisada",
        "RBAC por proyecto",
        "Auditoría y trazabilidad",
        "Infraestructura self-hosted",
      ],
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <LandingExperience />
    <a className="skip-link" href="#contenido">Saltar al contenido</a>
    <div className="page-noise" aria-hidden="true"></div>
    <div className="scroll-progress" aria-hidden="true"><span></span></div>

    <header className="site-header" data-header>
      <a className="brand" href="#inicio" aria-label="Marcus, inicio">
        <span className="brand__mark" aria-hidden="true"></span>
        <span>Marcus</span>
        <small>Agentic OS</small>
      </a>

      <nav className="main-nav" id="main-navigation" aria-label="Navegación principal" data-nav>
        <a href="#experiencia">Experiencia</a>
        <a href="#arquitectura">Arquitectura</a>
        <a href="/studio">Agent Studio</a>
        <a href="/casos-de-uso">Casos de uso</a>
        <a href="/empresas">Empresas</a>
        <a href="/documentacion">Documentación</a>
      </nav>

      <div className="header-actions">
        <button className="icon-button motion-toggle" type="button" data-motion-toggle aria-pressed="false" aria-label="Pausar animaciones">
          <svg className="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
          <svg className="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>
        </button>
        <a className="header-github" href="https://github.com/stock42/marcus" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
        <a className="button button--compact" href="#instalar">Instalar Marcus</a>
        <button className="menu-toggle" type="button" data-menu-toggle aria-controls="main-navigation" aria-expanded="false">
          <span></span><span></span><span></span><span className="sr-only">Abrir menú</span>
        </button>
      </div>
    </header>

    <main id="contenido">
      <section className="hero" id="inicio" aria-labelledby="hero-title">
        <div className="hero__ambient" aria-hidden="true">
          <span className="ambient ambient--one"></span>
          <span className="ambient ambient--two"></span>
        </div>
        <div className="hero__content content-width">
          <div className="hero__copy">
            <div className="eyebrow reveal" data-reveal>
              <span className="status-dot"></span>
              Infraestructura agéntica · Self-hosted · Bun-first
            </div>
            <h1 id="hero-title" className="hero__title reveal" data-reveal>
              Tus agentes<br />
              dejan de ser <em>demos.</em>
            </h1>
            <p className="hero__lead reveal" data-reveal>
              Marcus es el sistema operativo agéntico para <strong>construir, versionar, gobernar y operar</strong> agentes reales dentro de la infraestructura de tu empresa.
            </p>
            <div className="hero__actions reveal" data-reveal>
              <a className="button button--signal" href="/studio">
                Creá un agente ahora
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
              </a>
              <a className="button" href="#experiencia">
                Ver Marcus en acción
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
              </a>
              <a className="text-link" href="#arquitectura">Explorar la arquitectura <span aria-hidden="true">↓</span></a>
            </div>
            <div className="hero-install reveal" data-reveal>
              <div>
                <span className="hero-install__label">CLI + servidor · instalación estable</span>
                <code><span aria-hidden="true">$</span> curl -fsSL https://projectmarcus.com/install | sh</code>
              </div>
              <button className="copy-button" type="button" data-copy="curl -fsSL https://projectmarcus.com/install | sh" aria-label="Copiar comando de instalación">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9zM5 15H4V4h11v1" /></svg>
                <span>Copiar</span>
              </button>
            </div>
          </div>

          <div className="hero__system reveal" data-reveal role="img" aria-label="Diagrama animado de Marcus: las interfaces se conectan con el daemon, el Kernel, los Runtime Hosts y los agentes">
            <div className="system-frame" data-system-frame>
              <div className="system-frame__top">
                <span>MARCUS / LIVE TOPOLOGY</span>
                <span className="system-clock" data-clock>00:00:00 ART</span>
              </div>
              <svg className="topology-lines" viewBox="0 0 620 610" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <filter id="signal-glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>
                <path className="topology-path topology-path--a" d="M80 140 C180 140 166 305 272 305" />
                <path className="topology-path topology-path--b" d="M540 140 C440 140 455 305 348 305" />
                <path className="topology-path topology-path--c" d="M310 356 C310 410 170 414 170 488" />
                <path className="topology-path topology-path--d" d="M310 356 C310 410 450 414 450 488" />
                <circle className="signal signal--a" r="4"><animateMotion dur="3.4s" repeatCount="indefinite" path="M80 140 C180 140 166 305 272 305" /></circle>
                <circle className="signal signal--b" r="4"><animateMotion dur="4.1s" begin="-.8s" repeatCount="indefinite" path="M540 140 C440 140 455 305 348 305" /></circle>
                <circle className="signal signal--c" r="4"><animateMotion dur="3.7s" begin="-1.7s" repeatCount="indefinite" path="M310 356 C310 410 170 414 170 488" /></circle>
                <circle className="signal signal--d" r="4"><animateMotion dur="4.4s" begin="-2.3s" repeatCount="indefinite" path="M310 356 C310 410 450 414 450 488" /></circle>
              </svg>

              <div className="topology-node node--interface">
                <span className="node__index">01</span><strong>CLI / API</strong><small>Interfaces</small>
              </div>
              <div className="topology-node node--control">
                <span className="node__index">02</span><strong>BACKOFFICE</strong><small>Control plane</small>
              </div>
              <div className="kernel-orbit">
                <span className="orbit orbit--outer"></span>
                <span className="orbit orbit--inner"></span>
                <div className="kernel-core">
                  <small>AUTHORITY</small>
                  <strong>M</strong>
                  <span>marcusd</span>
                </div>
                <span className="kernel-status"><i></i> kernel ready</span>
              </div>
              <div className="topology-node node--runtime">
                <span className="node__index">03</span><strong>RUNTIME HOST</strong><small>Worker / Process</small>
              </div>
              <div className="topology-node node--agent">
                <span className="node__index">04</span><strong>AGENT FLEET</strong><small>Versioned / supervised</small>
              </div>
              <div className="system-event event--one"><span></span> run.completed</div>
              <div className="system-event event--two"><span></span> audit.appended</div>
              <div className="system-event event--three"><span></span> checkpoint.saved</div>
              <div className="system-frame__footer">
                <span><i className="status-dot"></i> 127.0.0.1:4242</span>
                <span>MNP/1 · SQLITE/WAL</span>
              </div>
            </div>
          </div>
        </div>

        <div className="hero__rail" aria-label="Características principales">
          <div className="rail-track">
            <span>Una sola autoridad</span><i></i><span>Estado durable</span><i></i><span>Agentes supervisados</span><i></i><span>RBAC por proyecto</span><i></i><span>Auditoría completa</span><i></i><span>Runtime propio</span><i></i>
            <span aria-hidden="true">Una sola autoridad</span><i aria-hidden="true"></i><span aria-hidden="true">Estado durable</span><i aria-hidden="true"></i><span aria-hidden="true">Agentes supervisados</span><i aria-hidden="true"></i><span aria-hidden="true">RBAC por proyecto</span><i aria-hidden="true"></i><span aria-hidden="true">Auditoría completa</span><i aria-hidden="true"></i><span aria-hidden="true">Runtime propio</span><i aria-hidden="true"></i>
          </div>
        </div>
      </section>

      <section className="manifesto section" aria-labelledby="manifesto-title">
        <div className="content-width manifesto__grid">
          <div className="section-index reveal" data-reveal><span>01</span> El cambio de escala</div>
          <div>
            <h2 id="manifesto-title" className="manifesto__title reveal" data-reveal>
              Un agente no es un prompt.<br />
              <span>Es software en producción.</span>
            </h2>
            <div className="manifesto__body">
              <p className="reveal" data-reveal>Cuando un agente toca datos, ejecuta herramientas y toma decisiones, necesita mucho más que una ventana de chat.</p>
              <p className="reveal" data-reveal>Necesita identidad, versiones inmutables, procesos supervisados, permisos, secretos, trazabilidad, recuperación y una autoridad que mantenga el sistema coherente.</p>
            </div>
          </div>
        </div>
        <div className="manifesto__statement content-width reveal" data-reveal>
          <span>Marcus convierte</span>
          <strong>agentes experimentales</strong>
          <svg viewBox="0 0 180 32" aria-hidden="true"><path d="M2 16h170M155 3l17 13-17 13" /></svg>
          <strong>infraestructura operable.</strong>
        </div>
      </section>

      <section className="experience section section--dark" id="experiencia" aria-labelledby="experience-title">
        <div className="content-width">
          <div className="section-heading">
            <div className="section-index section-index--dark reveal" data-reveal><span>02</span> Primeros cuatro minutos</div>
            <div>
              <h2 id="experience-title" className="display-title reveal" data-reveal>De cero a tu primer<br /><em>agente supervisado.</em></h2>
              <p className="section-lead reveal" data-reveal>Sin un laberinto de servicios ni una plataforma que se lleva tus datos. Elegí un paso o dejá que Marcus te muestre el flujo completo.</p>
            </div>
          </div>

          <div className="console-journey reveal" data-reveal data-console>
            <div className="journey-steps" role="tablist" aria-label="Recorrido inicial de Marcus">
              <button className="journey-step is-active" type="button" role="tab" aria-selected="true" aria-controls="terminal-panel" data-step="0">
                <span>01</span><strong>Instalar</strong><i></i>
              </button>
              <button className="journey-step" type="button" role="tab" aria-selected="false" aria-controls="terminal-panel" data-step="1">
                <span>02</span><strong>Iniciar</strong><i></i>
              </button>
              <button className="journey-step" type="button" role="tab" aria-selected="false" aria-controls="terminal-panel" data-step="2">
                <span>03</span><strong>Proyecto</strong><i></i>
              </button>
              <button className="journey-step" type="button" role="tab" aria-selected="false" aria-controls="terminal-panel" data-step="3">
                <span>04</span><strong>Agente</strong><i></i>
              </button>
            </div>

            <div className="terminal-shell" id="terminal-panel" role="tabpanel" tabIndex={0} aria-label="Simulador de consola Marcus">
              <div className="terminal-bar">
                <div className="terminal-dots" aria-hidden="true"><span></span><span></span><span></span></div>
                <span>marcus — 127.0.0.1:4242</span>
                <button type="button" className="terminal-replay" data-replay>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4m0 0h4M4 4l4 4a7 7 0 1 1-1.3 9.5" /></svg>
                  Repetir
                </button>
              </div>
              <div className="terminal-screen">
                <div className="terminal-context">
                  <span data-terminal-kicker>PASO 01 · INSTALAR</span>
                  <span><i></i> sesión local segura</span>
                </div>
                <div
                  className="terminal-output"
                  data-terminal-output
                  tabIndex={0}
                  aria-label="Transcripción de la consola Marcus"
                >
                  {initialTerminalStep?.lines.map((line, index) => (
                    <p className={`terminal-line terminal-line--${line.kind}`} key={`${line.kind}-${index}`}>
                      {line.value}
                    </p>
                  ))}
                </div>
              </div>
            </div>
            <p className="sr-only" role="status" aria-live="polite" data-terminal-announcement></p>

            <aside className="journey-copy">
              <span className="journey-copy__number" data-step-number>01</span>
              <div>
                <p className="journey-copy__eyebrow" data-step-label>INSTALAR</p>
                <h3 data-step-title>Un comando. Tu infraestructura.</h3>
                <p data-step-description>El instalador detecta plataforma y arquitectura, valida tamaños y SHA-256 y deja los ejecutables públicos en tu usuario.</p>
                <small className="journey-copy__source">Transcripts JSON · comandos validados por el parser de Marcus CLI</small>
              </div>
              <div className="journey-controls">
                <button type="button" data-step-previous aria-label="Paso anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button>
                <span><b data-current-step>1</b> / 4</span>
                <button type="button" data-step-next aria-label="Paso siguiente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="architecture section" id="arquitectura" aria-labelledby="architecture-title">
        <div className="content-width">
          <div className="section-heading section-heading--light">
            <div className="section-index reveal" data-reveal><span>03</span> Arquitectura</div>
            <div>
              <h2 id="architecture-title" className="display-title reveal" data-reveal>Una autoridad.<br /><em>Todo bajo control.</em></h2>
              <p className="section-lead reveal" data-reveal>La CLI y la API no atraviesan el sistema por atajos. Toda operación llega a <code>marcusd</code>, donde identidad, política, estado y ejecución comparten una única verdad.</p>
            </div>
          </div>

          <div className="architecture-stage reveal" data-reveal>
            <div className="architecture-map" aria-hidden="true">
              <svg viewBox="0 0 1100 650" preserveAspectRatio="none">
                <path className="map-line" d="M205 153H430C490 153 475 323 540 323" />
                <path className="map-line" d="M205 323H540" />
                <path className="map-line" d="M205 493H430C490 493 475 323 540 323" />
                <path className="map-line" d="M645 323H790" />
                <path className="map-line" d="M880 323V175" />
                <path className="map-line" d="M880 323V475" />
                <path className="map-pulse map-pulse--one" d="M205 153H430C490 153 475 323 540 323" />
                <path className="map-pulse map-pulse--two" d="M205 493H430C490 493 475 323 540 323" />
                <path className="map-pulse map-pulse--three" d="M645 323H790" />
              </svg>
              <div className="map-card map-card--cli"><span>01</span><strong>Marcus CLI</strong><small>Operadores y automatización</small></div>
              <div className="map-card map-card--api"><span>02</span><strong>REST / WS API</strong><small>Integraciones y Backoffice</small></div>
              <div className="map-card map-card--source"><span>03</span><strong>SDK / Markdown</strong><small>Fuentes de agentes</small></div>
              <div className="map-core"><i></i><small>AUTORIDAD</small><strong>marcusd</strong><span>Kernel + SQLite</span></div>
              <div className="map-gate"><span>MNP/1</span><strong>AUTH<br />RBAC<br />AUDIT</strong></div>
              <div className="map-card map-card--worker"><span>04</span><strong>Worker Runtime</strong><small>Ejecución eficiente</small></div>
              <div className="map-card map-card--process"><span>05</span><strong>Process Runtime</strong><small>Aislamiento operativo</small></div>
            </div>
            <div className="architecture-facts">
              <article><span>01</span><h3>Frontera clara</h3><p>MNP/1 conecta clientes con la autoridad sin permitir acceso directo al Kernel ni a SQLite.</p></article>
              <article><span>02</span><h3>Estado durable</h3><p>Runs, schedules, checkpoints, conversaciones, procesos y auditoría sobreviven reinicios.</p></article>
              <article><span>03</span><h3>Ejecución supervisada</h3><p>Perfiles Worker y proceso, instancias residentes, recuperación y cancelación observable.</p></article>
            </div>
          </div>
        </div>
      </section>

      <section className="capabilities section" id="capacidades" aria-labelledby="capabilities-title">
        <div className="content-width">
          <div className="capabilities__intro">
            <div className="section-index reveal" data-reveal><span>04</span> Capacidades</div>
            <h2 id="capabilities-title" className="display-title reveal" data-reveal>La capa que faltaba<br />entre el modelo y <em>la empresa.</em></h2>
          </div>

          <div className="capability-grid">
            <article className="capability-card capability-card--governance reveal" data-reveal>
              <div className="capability-card__top"><span>GOBERNANZA / 01</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7zM9 12l2 2 4-5" /></svg></div>
              <h3>Permisos que viven en el servidor.</h3>
              <p>Usuarios, tokens, service accounts y RBAC por proyecto. La política se valida en cada operación, no en la visibilidad de un botón.</p>
              <div className="policy-visual" aria-hidden="true">
                <span>project_owner</span><i>projects.*</i><b>ALLOW</b>
                <span>project_viewer</span><i>files.write</i><b className="deny">DENY</b>
                <span>service_agent</span><i>runs.invoke</i><b>ALLOW</b>
              </div>
            </article>

            <article className="capability-card capability-card--versions reveal" data-reveal>
              <div className="capability-card__top"><span>VERSIONES / 02</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v5H6zM6 16h12v5H6zM12 8v8" /></svg></div>
              <h3>Agentes inmutables. Evolución explícita.</h3>
              <p>Cada build registra una AgentVersion. Compará la fuente, validá el cambio y activá una versión sin borrar la historia.</p>
              <div className="version-visual" aria-hidden="true">
                <span>v1</span><span>v2</span><span className="active">v3 <small>ACTIVA</small></span><i></i>
              </div>
            </article>

            <article className="capability-card capability-card--runtime reveal" data-reveal>
              <div className="capability-card__top"><span>RUNTIME / 03</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9 3 12l5 3M16 9l5 3-5 3M14 4l-4 16" /></svg></div>
              <h3>Un runtime, no una caja negra.</h3>
              <p>Concurrencia, rate limits, deadlines, cancelación, procesos residentes, recuperación y límites operativos gobernados por el Kernel.</p>
              <div className="runtime-visual" aria-hidden="true">
                <div><span>RUNNING</span><i style={{ "--load": "72%" } as CSSProperties}></i></div>
                <div><span>QUEUED</span><i style={{ "--load": "44%" } as CSSProperties}></i></div>
                <div><span>RECOVERED</span><i style={{ "--load": "88%" } as CSSProperties}></i></div>
              </div>
            </article>

            <article className="capability-card capability-card--observability reveal" data-reveal>
              <div className="capability-card__top"><span>TRAZABILIDAD / 04</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V9m5 9V5m5 13v-7m5 7V3" /></svg></div>
              <h3>Todo Run deja evidencia.</h3>
              <p>Eventos, progreso, logs redactados, checkpoints, artifacts y auditoría. Entendé qué pasó sin reconstruirlo desde fragmentos.</p>
              <div className="trace-visual" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><span></span></div>
            </article>

            <article className="capability-card capability-card--authoring reveal" data-reveal>
              <div className="capability-card__top"><span>AUTORÍA / 05</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h7" /></svg></div>
              <h3>TypeScript nativo o Markdown declarativo.</h3>
              <p>Definí contratos tipados con el SDK Bun-native o compilá agentes Markdown al mismo manifiesto <code>marcus.agent/v1</code>.</p>
              <div className="authoring-visual" aria-hidden="true"><span>.ts</span><i>→</i><strong>AGENT<br />MANIFEST</strong><i>←</i><span>.md</span></div>
            </article>

            <article className="capability-card capability-card--connect reveal" data-reveal>
              <div className="capability-card__top"><span>INTEGRACIÓN / 06</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12h8M12 8l4 4-4 4M5 5v14M19 5v14" /></svg></div>
              <h3>Conectá el sistema que ya tenés.</h3>
              <p>CLI persistente, REST, WebSocket, entrypoints autenticados, schedules, mensajes y eventos. Marcus entra en tu arquitectura; no exige reemplazarla.</p>
              <div className="connect-visual" aria-hidden="true"><span>CLI</span><span>REST</span><span>WS</span><span>EVENT</span></div>
            </article>
          </div>
        </div>
      </section>

      <section className="home-use-cases section" aria-labelledby="home-use-cases-title">
        <div className="content-width">
          <div className="section-heading">
            <div className="section-index reveal" data-reveal><span>05</span> Casos de uso</div>
            <div>
              <h2 id="home-use-cases-title" className="display-title reveal" data-reveal>IA conectada con<br /><em>la operación real.</em></h2>
              <p className="section-lead reveal" data-reveal>Desde soporte hasta incidentes: cada agente trabaja con contratos, tools autorizadas y evidencia que tu equipo puede revisar.</p>
            </div>
          </div>
          <div className="home-use-cases__grid">
            {USE_CASES.slice(0, 3).map((useCase, index) => (
              <article className="home-use-case reveal" data-reveal key={useCase.slug}>
                <span>{String(index + 1).padStart(2, "0")} / {useCase.sector}</span>
                <h3>{useCase.title}</h3>
                <p>{useCase.summary}</p>
              </article>
            ))}
          </div>
          <div className="home-use-cases__action reveal" data-reveal><a href="/casos-de-uso">Explorar todos los casos de uso <span aria-hidden="true">→</span></a></div>
        </div>
      </section>

      <section className="sovereignty section section--signal" aria-labelledby="sovereignty-title">
        <div className="content-width sovereignty__grid">
          <div>
            <div className="section-index section-index--signal reveal" data-reveal><span>06</span> Control real</div>
            <h2 id="sovereignty-title" className="display-title reveal" data-reveal>Tu infraestructura.<br />Tus modelos.<br /><em>Tus reglas.</em></h2>
          </div>
          <div className="sovereignty__content">
            <p className="sovereignty__lead reveal" data-reveal>Marcus puede operar completamente dentro de tu red. Elegís dónde viven los datos, qué proveedores usa cada rol y cómo se publica cada interfaz.</p>
            <div className="sovereignty-list">
              <article className="reveal" data-reveal><span>01</span><div><h3>Self-hosted por diseño</h3><p>Daemon, API, Backoffice y runtimes bajo control del operador.</p></div></article>
              <article className="reveal" data-reveal><span>02</span><div><h3>Proveedores intercambiables</h3><p>Roles de modelo desacoplados de los agentes y credenciales administradas como secretos.</p></div></article>
              <article className="reveal" data-reveal><span>03</span><div><h3>Exposición deliberada</h3><p>Listeners locales por defecto; HTTPS remoto mediante el reverse proxy de tu organización.</p></div></article>
              <article className="reveal" data-reveal><span>04</span><div><h3>Backup y recuperación</h3><p>Inventario verificable, backup online y restore offline sin esconder el estado crítico.</p></div></article>
            </div>
            <a className="text-link reveal" data-reveal href="/empresas">Ver Marcus para empresas <span aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>

      <section className="adoption section section--dark" id="adopcion" aria-labelledby="adoption-title">
        <div className="content-width">
          <div className="section-heading">
            <div className="section-index section-index--dark reveal" data-reveal><span>07</span> Implementación</div>
            <div>
              <h2 id="adoption-title" className="display-title reveal" data-reveal>Empezá local.<br /><em>Operá como empresa.</em></h2>
              <p className="section-lead reveal" data-reveal>El mismo modelo mental acompaña al equipo desde la primera prueba hasta una instalación administrada por infraestructura.</p>
            </div>
          </div>

          <div className="adoption-track">
            <article className="adoption-step reveal" data-reveal>
              <span className="adoption-step__number">01</span>
              <div className="adoption-step__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H4zM8 21h8M9 9l2 2-2 2M13 13h3" /></svg></div>
              <h3>Validá en local</h3>
              <p>Instalá en tu usuario, levantá <code>marcusd</code> y construí el primer flujo con la CLI.</p>
              <small>~/.marcus</small>
            </article>
            <article className="adoption-step reveal" data-reveal>
              <span className="adoption-step__number">02</span>
              <div className="adoption-step__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5zM9 9h6v6H9zM2 8h3M2 16h3M19 8h3M19 16h3" /></svg></div>
              <h3>Integrá sistemas</h3>
              <p>Conectá aplicaciones, eventos y operadores por REST, WebSocket, schedules o entrypoints.</p>
              <small>MNP/1 + API</small>
            </article>
            <article className="adoption-step reveal" data-reveal>
              <span className="adoption-step__number">03</span>
              <div className="adoption-step__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3 8 8 9 5-1 8-4 8-9V7zM8 12h8M12 8v8" /></svg></div>
              <h3>Goberná el acceso</h3>
              <p>Definí miembros, service accounts, secretos, AuthValidators, auditoría y aprobaciones.</p>
              <small>RBAC + AUDIT</small>
            </article>
            <article className="adoption-step reveal" data-reveal>
              <span className="adoption-step__number">04</span>
              <div className="adoption-step__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M6 18V9h4v9M14 18V5h4v13M3 21h18" /></svg></div>
              <h3>Operá en producción</h3>
              <p>Instalá servicios Linux, conectá observabilidad y publicá detrás del reverse proxy corporativo.</p>
              <small>SYSTEMD + NGINX</small>
            </article>
          </div>
        </div>
      </section>

      <section className="final-cta" id="instalar" aria-labelledby="final-title">
        <div className="final-cta__grid" aria-hidden="true"></div>
        <div className="content-width final-cta__content">
          <div className="final-cta__stamp reveal" data-reveal><span>M</span><small>READY<br />TO RUN</small></div>
          <h2 id="final-title" className="reveal" data-reveal>La próxima generación<br />de software <em>no se mira.</em><br /><strong>Se opera.</strong></h2>
          <p className="reveal" data-reveal>El instalador base descarga el CLI y el servidor. El Backoffice queda desacoplado para que cada equipo lo despliegue solamente cuando lo necesita.</p>
          <div className="final-install reveal" data-reveal>
            <div><span>$</span><code>curl -fsSL https://projectmarcus.com/install | sh</code></div>
            <button className="button button--signal" type="button" data-copy="curl -fsSL https://projectmarcus.com/install | sh">
              <span>Copiar e instalar</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9zM5 15H4V4h11v1" /></svg>
            </button>
          </div>
          <p className="final-install__note reveal" data-reveal>Incluye <code>marcus</code>, <code>marcusd</code> y <code>marcus-api</code>. No clona el repositorio ni instala el Backoffice.</p>
          <div className="final-links reveal" data-reveal>
            <a href="https://github.com/stock42/marcus" target="_blank" rel="noreferrer">Explorar el código <span aria-hidden="true">↗</span></a>
            <a href="/documentacion">Leer documentación <span aria-hidden="true">→</span></a>
          </div>
        </div>
      </section>
    </main>

    <footer className="site-footer">
      <div className="content-width site-footer__main">
        <a className="brand brand--footer" href="#inicio" aria-label="Marcus, volver al inicio">
          {/* The source PNG is already resized and transparent; serving it verbatim avoids runtime optimization work. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand__logo" src="/marcus-logo.png" width={303} height={270} alt="Marcus" />
        </a>
        <p>Agentic OS para equipos que convierten inteligencia artificial en infraestructura real.</p>
        <div className="footer-nav">
          <a href="#experiencia">Experiencia</a><a href="#arquitectura">Arquitectura</a><a href="/casos-de-uso">Casos de uso</a><a href="/empresas">Empresas</a><a href="/documentacion">Documentación</a><a href="/documentacion/sdk">SDK TypeScript</a><a href="/documentacion/markdown">Agentes Markdown</a><a href="/documentacion/tools">Tools oficiales</a><a href="/llms.txt">llms.txt</a>
        </div>
      </div>
      <div className="content-width site-footer__bottom">
        <span>© 2026 Marcus contributors · Apache-2.0</span>
        <span className="site-footer__credit">Powered by <a href="https://stock42.com" target="_blank" rel="noreferrer">Stock42 LLC</a></span>
      </div>
    </footer>

    <div className="copy-toast" role="status" aria-live="polite" data-copy-toast>Comando copiado</div>
        </>
  );
}
