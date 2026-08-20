import Link from "next/link";
import type { ReactNode } from "react";

export type MarketingSection = "use-cases" | "enterprise" | "documentation" | "studio";

export function MarketingShell({ active, children }: { active: MarketingSection; children: ReactNode }) {
  return (
    <div className="marketing-page">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <div className="page-noise" aria-hidden="true" />
      <header className="docs-topbar marketing-topbar">
        <Link className="brand" href="/" aria-label="Marcus, inicio">
          <span className="brand__mark" aria-hidden="true" />
          <span>Marcus</span>
          <small>Agentic OS</small>
        </Link>
        <nav className="docs-global-nav" aria-label="Navegación principal">
          <Link href="/">Producto</Link>
          <Link href="/studio" aria-current={active === "studio" ? "page" : undefined}>Agent Studio</Link>
          <Link href="/casos-de-uso" aria-current={active === "use-cases" ? "page" : undefined}>Casos de uso</Link>
          <Link href="/empresas" aria-current={active === "enterprise" ? "page" : undefined}>Empresas</Link>
          <Link href="/documentacion" aria-current={active === "documentation" ? "page" : undefined}>Documentación</Link>
        </nav>
        <Link className="button button--compact" href="/#instalar">Instalar Marcus</Link>
      </header>

      <main id="contenido">{children}</main>

      <footer className="docs-footer marketing-footer">
        <div className="content-width docs-footer__inner">
          <div><strong>Marcus</strong><span>Infraestructura agéntica bajo tu control.</span></div>
          <nav aria-label="Enlaces públicos">
            <Link href="/casos-de-uso">Casos de uso</Link>
            <Link href="/empresas">Empresas</Link>
            <Link href="/documentacion">Documentación</Link>
            <Link href="/studio">Agent Studio</Link>
            <Link href="/llms.txt">llms.txt</Link>
          </nav>
          <span className="site-footer__credit">Powered by <a href="https://stock42.com" target="_blank" rel="noreferrer">Stock42 LLC</a></span>
        </div>
      </footer>
    </div>
  );
}
