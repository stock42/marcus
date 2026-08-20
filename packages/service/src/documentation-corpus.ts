/// <reference path="./markdown-modules.d.ts" />

import api from "../../../documentation/API.md" with { type: "text" };
import backoffice from "../../../documentation/BACKOFFICE.md" with { type: "text" };
import cli from "../../../documentation/CLI.md" with { type: "text" };
import configuration from "../../../documentation/CONFIGURATION.md" with { type: "text" };
import development from "../../../documentation/DEVELOPMENT.md" with { type: "text" };
import distribution from "../../../documentation/DISTRIBUTION.md" with { type: "text" };
import install from "../../../documentation/INSTALL.md" with { type: "text" };
import kernel from "../../../documentation/KERNEL.md" with { type: "text" };
import markdown from "../../../documentation/MARKDOWN.md" with { type: "text" };
import mcp from "../../../documentation/MCP.md" with { type: "text" };
import operations from "../../../documentation/OPERATIONS.md" with { type: "text" };
import overview from "../../../documentation/README.md" with { type: "text" };
import runtime from "../../../documentation/RUNTIME.md" with { type: "text" };
import sdk from "../../../documentation/SDK.md" with { type: "text" };
import security from "../../../documentation/SECURITY.md" with { type: "text" };
import tools from "../../../documentation/TOOLS.md" with { type: "text" };
import website from "../../../documentation/WEBSITE.md" with { type: "text" };

export const marcusDocumentation = {
  "README.md": overview,
  "INSTALL.md": install,
  "CLI.md": cli,
  "API.md": api,
  "BACKOFFICE.md": backoffice,
  "CONFIGURATION.md": configuration,
  "DEVELOPMENT.md": development,
  "DISTRIBUTION.md": distribution,
  "KERNEL.md": kernel,
  "MARKDOWN.md": markdown,
  "MCP.md": mcp,
  "OPERATIONS.md": operations,
  "RUNTIME.md": runtime,
  "SDK.md": sdk,
  "TOOLS.md": tools,
  "SECURITY.md": security,
  "WEBSITE.md": website,
} as const;

export type MarcusDocumentationName = keyof typeof marcusDocumentation;

export const marcusDocumentationCorpus = Object.entries(marcusDocumentation)
  .map(([name, content]) => `\n\n<document name="${name}">\n${content.trim()}\n</document>`)
  .join("");

export const marcusMarkdownAuthoringGuide = [markdown, cli, sdk]
  .map((content) => content.trim())
  .join("\n\n---\n\n");
