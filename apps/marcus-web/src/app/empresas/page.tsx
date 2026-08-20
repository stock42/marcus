import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing-shell";
import { ENTERPRISE_FAQS } from "@/data/public-content";
import { SITE_NAME, SITE_URL, SOCIAL_IMAGE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Marcus para empresas | Servidor de agentes de IA self-hosted",
  description: "Desplegá Marcus en un servidor local o AWS, operá agentes de IA bajo tu control y evitá una tarifa por agente.",
  alternates: { canonical: "/empresas" },
  openGraph: { title: "Marcus para PyMEs y grandes empresas", description: "Tu infraestructura de agentes, en tu red y sin precio por agente.", url: "/empresas", siteName: SITE_NAME, locale: "es_ES", type: "website", images: [{ url: SOCIAL_IMAGE, width: 1731, height: 909 }] },
  twitter: { card: "summary_large_image", title: "Marcus para PyMEs y grandes empresas", description: "Tu servidor de agentes de IA, self-hosted y sin precio por agente.", images: [SOCIAL_IMAGE] },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service",
      name: "Marcus Agentic OS self-hosted",
      provider: { "@type": "Organization", name: "Stock42 LLC", url: "https://stock42.com" },
      areaServed: ["Latin America", "Spain"],
      audience: { "@type": "BusinessAudience", audienceType: "PyMEs y grandes empresas" },
      url: `${SITE_URL}/empresas`,
      description: "Infraestructura self-hosted para construir y operar agentes de IA sin tarifa por agente.",
    },
    {
      "@type": "FAQPage",
      mainEntity: ENTERPRISE_FAQS.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
    },
  ],
};

export default function EnterprisePage() {
  return (
    <MarketingShell active="enterprise">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <section className="marketing-hero marketing-hero--enterprise" aria-labelledby="enterprise-title">
        <div className="content-width marketing-hero__grid">
          <div><div className="docs-eyebrow"><span />PYMES / ENTERPRISE / SELF-HOSTED</div><h1 id="enterprise-title">Tu servidor de agentes. <em>Sin precio por agente.</em></h1></div>
          <div className="marketing-hero__aside"><p>Instalá Marcus en un servidor local o en AWS. La infraestructura queda en tu empresa y el costo de Marcus no crece por sumar agentes.</p><Link className="button button--signal" href="/#instalar">Instalar Marcus</Link></div>
        </div>
      </section>

      <section className="marketing-section marketing-section--paper" aria-labelledby="company-path-title">
        <div className="content-width">
          <div className="marketing-section__heading"><span>01 / DOS PUNTOS DE PARTIDA</span><div><h2 id="company-path-title">Empezá con tu escala.<br /><em>Conservá el mismo control.</em></h2><p>La arquitectura evita obligarte a adoptar un control plane SaaS para poder operar agentes reales.</p></div></div>
          <div className="company-paths">
            <article><span>PYME</span><h3>Un host, todo el sistema.</h3><p>Validá en un servidor Linux, separá Projects por equipo y administrá agentes, usuarios, Runs y proveedores desde el Backoffice.</p><ul><li>Instalación por usuario en <code>~/.marcus</code></li><li>Backups y logs centralizados</li><li>CLI, API y Backoffice opcional</li></ul></article>
            <article><span>GRAN EMPRESA</span><h3>Una autoridad por frontera.</h3><p>Desplegá instalaciones separadas por entorno o unidad cuando necesites límites independientes de red, estado y operación.</p><ul><li>RBAC y tokens por Project</li><li>Reverse proxy y TLS de la organización</li><li>Auditoría, approvals y versiones inmutables</li></ul></article>
          </div>
        </div>
      </section>

      <section className="marketing-section deployment-section" aria-labelledby="deployment-title">
        <div className="content-width">
          <div className="marketing-section__heading marketing-section__heading--dark"><span>02 / DÓNDE CORRE</span><div><h2 id="deployment-title">En tu red.<br />O en <em>tu cloud.</em></h2><p>Marcus escucha en loopback por defecto. Tu organización decide si una interfaz cruza esa frontera.</p></div></div>
          <div className="deployment-grid">
            <article><div className="deployment-grid__top"><span>LOCAL / ON-PREMISE</span><strong>01</strong></div><h3>Servidor Linux de la empresa</h3><div className="deployment-diagram" aria-label="Topología local"><span>Equipos</span><i>→</i><span>Proxy opcional</span><i>→</i><strong>Marcus host</strong></div><ol><li><span>01</span>Instalá CLI, daemon y API.</li><li><span>02</span>Conservá estado y backups bajo <code>~/.marcus</code>.</li><li><span>03</span>Exponé sólo lo que requiera la red interna.</li></ol></article>
            <article><div className="deployment-grid__top"><span>AWS</span><strong>02</strong></div><h3>Instancia privada dentro de tu VPC</h3><div className="deployment-diagram" aria-label="Topología AWS"><span>VPC</span><i>→</i><span>Proxy / TLS</span><i>→</i><strong>EC2 + volumen</strong></div><ol><li><span>01</span>Usá una instancia Linux y almacenamiento durable.</li><li><span>02</span>Administrá ingress, TLS y secretos con tus controles.</li><li><span>03</span>Programá backups y monitoreo de host.</li></ol></article>
          </div>
          <p className="deployment-boundary"><strong>Límite actual:</strong> una instalación mantiene una sola autoridad <code>marcusd</code>. Para aislar producción, staging o unidades de negocio, usá instalaciones independientes; no asumimos un clúster active-active que Marcus todavía no promete.</p>
        </div>
      </section>

      <section className="marketing-section cost-section" aria-labelledby="cost-title">
        <div className="content-width cost-section__grid">
          <div><span>03 / MODELO DE COSTO</span><h2 id="cost-title">Más agentes.<br /><em>No más licencias.</em></h2></div>
          <div>
            <div className="cost-equation"><span>COSTO MARCUS</span><strong>1 instalación</strong><i>≠</i><strong>precio × agente</strong></div>
            <p>Marcus no agrega un medidor comercial por cada agente creado. Podés construir diez o cientos dentro de la capacidad de tu instalación.</p>
            <div className="cost-truth"><strong>Lo que sí puede variar</strong><p>CPU, memoria, almacenamiento, tráfico de AWS y consumo de tokens o inferencia del proveedor LLM. Son costos de la infraestructura y los modelos que elegís, no una tarifa Marcus por agente.</p></div>
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--paper" aria-labelledby="enterprise-control-title">
        <div className="content-width">
          <div className="marketing-section__heading"><span>04 / CONTROL CORPORATIVO</span><div><h2 id="enterprise-control-title">Autonomía con <em>límites verificables.</em></h2><p>El modelo propone y actúa únicamente dentro del contrato que la empresa activó.</p></div></div>
          <div className="enterprise-controls"><article><span>IDENTIDAD</span><h3>RBAC del lado servidor</h3><p>Usuarios, membresías, tokens y capacidades validados en cada operación.</p></article><article><span>CAMBIO</span><h3>Versiones inmutables</h3><p>Fuente, build y versión activa separados para revisar y revertir con evidencia.</p></article><article><span>RIESGO</span><h3>Aprobación humana</h3><p>Las operaciones críticas pueden quedar esperando una decisión durable.</p></article><article><span>OPERACIÓN</span><h3>Runs, logs y auditoría</h3><p>Cada ejecución deja estado, output, errores, tool calls y eventos consultables.</p></article></div>
        </div>
      </section>

      <section className="marketing-section faq-section" aria-labelledby="faq-title">
        <div className="content-width faq-section__grid"><div><span>05 / PREGUNTAS FRECUENTES</span><h2 id="faq-title">Antes de llevarlo <em>a producción.</em></h2></div><div>{ENTERPRISE_FAQS.map((faq, index) => <details key={faq.question} open={index === 0}><summary>{faq.question}<span aria-hidden="true">+</span></summary><p>{faq.answer}</p></details>)}</div></div>
      </section>

      <section className="marketing-close" aria-labelledby="enterprise-close-title"><div className="content-width"><span>INFRAESTRUCTURA PROPIA</span><h2 id="enterprise-close-title">Un servidor.<br />Todos los agentes que <em>tu operación necesite.</em></h2><div><Link className="button button--signal" href="/#instalar">Instalar Marcus</Link><Link className="text-link text-link--light" href="/casos-de-uso">Explorar casos de uso <span aria-hidden="true">→</span></Link></div></div></section>
    </MarketingShell>
  );
}
