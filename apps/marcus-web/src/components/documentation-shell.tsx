import Link from "next/link";
import type { ReactNode } from "react";
import { CopyCodeButton } from "@/components/copy-code-button";

export type DocumentationTocItem = { id: string; label: string };

export function DocumentationShell({
  active,
  eyebrow,
  title,
  description,
  toc,
  children,
}: {
  active: "sdk" | "markdown" | "tools";
  eyebrow: string;
  title: ReactNode;
  description: string;
  toc: readonly DocumentationTocItem[];
  children: ReactNode;
}) {
  return (
    <div className="documentation-page">
      <a className="skip-link" href="#documentacion-contenido">Saltar al contenido</a>
      <div className="page-noise" aria-hidden="true" />
      <header className="docs-topbar">
        <Link className="brand" href="/" aria-label="Marcus, inicio">
          <span className="brand__mark" aria-hidden="true" />
          <span>Marcus</span>
          <small>Agentic OS</small>
        </Link>
        <nav className="docs-global-nav" aria-label="Documentación Marcus">
          <Link href="/">Producto</Link>
          <Link href="/documentacion">Documentación</Link>
          <Link href="/documentacion/sdk" aria-current={active === "sdk" ? "page" : undefined}>SDK TypeScript</Link>
          <Link href="/documentacion/markdown" aria-current={active === "markdown" ? "page" : undefined}>Agentes Markdown</Link>
          <Link href="/documentacion/tools" aria-current={active === "tools" ? "page" : undefined}>Tools oficiales</Link>
        </nav>
        <Link className="button button--compact" href="/#instalar">Instalar Marcus</Link>
      </header>

      <main id="documentacion-contenido">
        <section className="docs-hero" aria-labelledby="docs-title">
          <div className="content-width docs-hero__grid">
            <div>
              <div className="docs-eyebrow"><span />{eyebrow}</div>
              <h1 id="docs-title">{title}</h1>
            </div>
            <p>{description}</p>
          </div>
        </section>

        <div className="content-width docs-layout">
          <aside className="docs-aside" aria-label="En esta guía">
            <span>EN ESTA GUÍA</span>
            <ol>{toc.map((item, index) => <li key={item.id}><a href={`#${item.id}`}><small>{String(index + 1).padStart(2, "0")}</small>{item.label}</a></li>)}</ol>
            <div className="docs-aside__switch">
              <span>OTRAS GUÍAS</span>
              {active !== "sdk" && <Link href="/documentacion/sdk">SDK TypeScript<span aria-hidden="true">↗</span></Link>}
              {active !== "markdown" && <Link href="/documentacion/markdown">Agentes Markdown<span aria-hidden="true">↗</span></Link>}
              {active !== "tools" && <Link href="/documentacion/tools">Tools oficiales<span aria-hidden="true">↗</span></Link>}
            </div>
          </aside>
          <article className="docs-content">{children}</article>
        </div>
      </main>

      <footer className="docs-footer">
        <div className="content-width docs-footer__inner">
          <div><strong>Marcus</strong><span>Documentación para construir agentes operables.</span></div>
          <nav aria-label="Enlaces de documentación">
            <Link href="/documentacion">Inicio</Link>
            <Link href="/documentacion/sdk">SDK</Link>
            <Link href="/documentacion/markdown">Markdown</Link>
            <Link href="/documentacion/tools">Tools</Link>
            <Link href="/llms.txt">llms.txt</Link>
          </nav>
          <span className="site-footer__credit">Powered by <a href="https://stock42.com" target="_blank" rel="noreferrer">Stock42 LLC</a></span>
        </div>
      </footer>
    </div>
  );
}

export function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="doc-code">
      <div className="doc-code__bar"><span>{label}</span><CopyCodeButton code={code} /></div>
      <pre tabIndex={0}><code>{code}</code></pre>
    </div>
  );
}

export function Step({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="doc-step">
      <div className="doc-step__number">{number}</div>
      <div className="doc-step__body"><h3>{title}</h3>{children}</div>
    </section>
  );
}
