# Public website

The public Marcus website lives in `apps/marcus-web` and powers the Spanish
`projectmarcus.com` experience. It presents Marcus as self-hosted agentic
infrastructure for companies in Latin America and Spain. It is separate from
the authenticated Backoffice and never connects to `marcusd` or Marcus API.

## Architecture

The website is a Next.js App Router application run exclusively through Bun.
This provides a direct path to future Marcus Cloud account and product routes
without maintaining a custom browser bundler or server.

There is no repository `build/` or `dist/` contract. Next uses its native,
Git-ignored `.next/` directory for development cache and production output.
That framework build transforms TSX for browsers and prepares the Next server;
it does not transpile Marcus packages into committed JavaScript.

## Run locally

From the monorepo root:

```bash
bun install --frozen-lockfile
bun run web
```

Open [http://127.0.0.1:4321](http://127.0.0.1:4321). The server binds only to
loopback. Override the port without affecting another Marcus service:

```bash
MARCUS_WEB_PORT=4400 bun run web
```

Run the production server locally with:

```bash
bun run web:production
```

## CLI journey source of truth

The four-stage console journey is defined in
`apps/marcus-web/src/data/cli-journey.json`:

1. Install the stable CLI and server release from `/install`.
2. Start `marcusd`, bootstrap `admin`, enter `marcus`, and display the real
   `agent.default` LLM diagnosis.
3. Create and select `testing-project`, including the observed JSON responses
   and contextual prompt.
4. Scaffold, upload, register, and invoke an SDK agent, ending with the actual
   queued Run response rather than an invented completion message.

Each Marcus command has a separate `command` field. Bun unit tests feed those
commands into the production `@marcus/cli` parser, validate transcript JSON,
and assert the observed login and Project examples. UI code reads the same JSON
through `src/lib/terminal-steps.ts`; do not duplicate commands in page markup or
client code.

The initial transcript is server-rendered so core content exists before client
hydration. Client behavior then adds typing, replay, tab navigation, automatic
progression, copy feedback, scroll reveals, and motion controls.

## Public information architecture

The home page stays focused on product value, the real CLI journey,
architecture, representative use cases and installation. Long-form content is
split into static, deep-linkable Spanish screens:

- `/casos-de-uso`: support, daily operations, incident response, document
  processing, internal knowledge and integration patterns, including applicable
  tools, control boundaries and expected outcomes.
- `/empresas`: separate paths for SMEs and larger organizations, honest local
  server and AWS topologies, the current single-authority boundary, governance,
  FAQs and the Marcus cost model. Marcus does not meter or charge per agent;
  infrastructure and LLM-provider consumption remain variable operator costs.
- `/documentacion`: the authoring gateway. It contains three complete Markdown
  examples, Codex and Claude MCP connection instructions and plan/create/verify
  tool sequences. Its hero also exposes the official Spanish Marcus 0.1.0 user
  manual as a versioned 44-page PDF download from
  `/downloads/marcus-manual-de-usuario-es-0.1.0-rev3.pdf`. It then routes to the
  detailed references:

- `/documentacion/sdk`: a complete first-success flow from SDK scaffold through
  upload, immutable build and Run, followed by schemas, lifecycle, Runtime
  Context, models/tools, entrypoints, authentication and testing.
- `/documentacion/markdown`: the equivalent declarative flow, canonical
  `marcus.agent/v1` frontmatter, section and schema reference, edit/apply cycle,
  Marcus AI generation and actionable compiler diagnostics.
- `/documentacion/tools`: the complete shared official Tool Runtime catalog,
  including schemas and policy for every capability.
- `/studio`: public agent-authoring laboratory. It accepts a Spanish brief,
  generates Markdown or TypeScript through DeepSeek and presents a fullscreen
  authoring workspace: brief at the left, source editor at the right and a
  chronological activity terminal below. It validates without execution and
  keeps browser-local versions for comparison, restoration, copying and
  download. Its dedicated gateway and operational contract are documented in
  [Agent Studio](./AGENT-STUDIO.md).

All screens use a semantic heading hierarchy, keyboard-visible focus,
responsive code containers, copy controls, a persistent desktop index and a
single-column mobile layout. Their commands and examples mirror the production
CLI, SDK and Markdown compiler rather than introducing a documentation-only
syntax.

The visible enterprise FAQ content and its `FAQPage` structured data share the
same source in `src/data/public-content.ts`. Use-case cards and their `ItemList`
structured data follow the same rule so search metadata cannot drift away from
the claims users read.

## Public installer endpoint

`apps/marcus-web/public/install` is served directly as
`https://projectmarcus.com/install`. It is a POSIX shell bootstrap that detects
platform and architecture, resolves the corresponding stable release path, and
delegates to the manifest-driven installer. It downloads the CLI and server
executables; it does not clone the repository or bundle the optional
Backoffice.

`bun run build:artifact` cross-compiles all four Linux/macOS x64/arm64 targets
into the ignored `apps/marcus-web/public/releases/` tree and proves the landing
command against a disposable static server. It deliberately does not rebuild or
restart Next: release filenames and public URLs are stable. The `@marcus/web`
production build remains an independent `next build`; `bun run package:release`
is an alias for the artifact command. A local build still does not upload
anything.
After deployment, `bun run verify:public-installer --full` repeats the complete
installation through the real `https://projectmarcus.com` endpoints. The public
installation claim is not valid while that gate fails.

## Build and validation

```bash
bun run --filter @marcus/web typecheck
bun run --filter @marcus/web test
bun run --filter @marcus/web lint
bun run test:browser:web
bun run verify:build
```

`test:browser:web` builds the production application, starts `next start` under
Bun plus a deterministic Studio gateway, verifies `/install` begins with a shell shebang, walks the visible login,
Project, and agent transcripts, rejects browser/page console errors, and checks
the documentation hub, SDK/Markdown/Tools guides, use cases, enterprise claims,
canonical URLs, `/llms.txt`, key commands and mobile horizontal overflow. It
also generates and refines a public Studio agent through the real HTTP and
WebSocket contracts, compares/restores local versions and verifies both source
and user-manual downloads.

The official transparent logo, favicon variants, Apple touch icon, and web
manifest live under `apps/marcus-web/public/`. `marcus-logo.png` is tightly
cropped from the 1024 px brand master without redrawing or changing its
proportions.

## Search and social discovery

The canonical public URL is `https://projectmarcus.com`. The root layout emits
Spanish title and description metadata, canonical and language alternates,
large-image Open Graph and X cards, and unrestricted indexing directives. The
supplied social artwork is published as
`/marcus-agentic-os-opengraph.png` at its original 1731×909 dimensions.

Next serves `/robots.txt` and `/sitemap.xml` from typed App Router metadata
routes; the sitemap includes the landing, content gateways and authoring guides.
The static root `/llms.txt` follows the llms.txt Markdown proposal and provides
LLM clients with a curated, canonical map of product, authoring, MCP and
installation sources. The landing publishes schema.org `Organization`,
`WebSite`, and `SoftwareApplication` JSON-LD; sublandings add `CollectionPage`,
`ItemList`, `Service` and visible-content-backed `FAQPage` data. Keep
`src/lib/site.ts`, `src/data/public-content.ts`, the visible product
claims, the manifest, and the structured data aligned whenever the public name,
domain, release version, or platform support changes.

Animations are progressive enhancement. The site supports keyboard-operated
tabs and controls, visible focus, a skip link, manual animation pause, and
`prefers-reduced-motion`.
