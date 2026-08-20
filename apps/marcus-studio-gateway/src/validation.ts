import { MarcusError } from "@marcus/contracts";
import { compileMarkdownAgent } from "@marcus/markdown";
import {
  STUDIO_LIMITS,
  safeStudioFilename,
  type StudioDiagnostic,
  type StudioFormat,
  type StudioGeneratedOutput,
} from "@marcus/studio-contracts";
import type { ProviderStudioOutput } from "./prompt";
import ts from "typescript";

export async function validateStudioOutput(output: ProviderStudioOutput, requestedFormat: StudioFormat): Promise<StudioGeneratedOutput> {
  if (output.format !== requestedFormat) throw studioValidationError("STUDIO_OUTPUT_INVALID", "El proveedor cambió el formato solicitado.");
  if (new TextEncoder().encode(output.source).byteLength > STUDIO_LIMITS.sourceBytes) {
    throw studioValidationError("STUDIO_OUTPUT_INVALID", "La fuente generada supera el límite de 64 KiB.");
  }
  const filename = safeStudioFilename(output.filename || output.name, requestedFormat);
  const diagnostics = requestedFormat === "markdown"
    ? await validateMarkdown(output.source)
    : validateTypescript(output.source);
  const valid = !diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    format: requestedFormat,
    filename,
    name: output.name.trim(),
    summary: output.summary.trim(),
    source: normalizeSource(output.source),
    assumptions: output.assumptions.map((item) => item.trim()).filter(Boolean),
    warnings: output.warnings.map((item) => item.trim()).filter(Boolean),
    diagnostics,
    valid,
    validationLabel: valid
      ? requestedFormat === "markdown" ? "Compilación determinística válida" : "Fuente TypeScript estáticamente válida · no ejecutada"
      : "Requiere revisión",
  };
}

async function validateMarkdown(source: string): Promise<StudioDiagnostic[]> {
  try {
    const compilation = await compileMarkdownAgent(normalizeSource(source));
    return compilation.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
      ...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
    }));
  } catch (error) {
    return [{
      code: error instanceof MarcusError ? error.code : "STUDIO_MARKDOWN_INVALID",
      severity: "error",
      message: error instanceof Error ? error.message : "El Markdown no pertenece al contrato Marcus.",
    }];
  }
}

function validateTypescript(source: string): StudioDiagnostic[] {
  const diagnostics: StudioDiagnostic[] = [];
  try {
    const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
    const imports = transpiler.scanImports(source);
    for (const item of imports) {
      if (item.path !== "@marcus/sdk") diagnostics.push(error("STUDIO_TS_IMPORT_FORBIDDEN", `El import ${item.path} no está permitido.`));
    }
    transpiler.transformSync(source);
  } catch (reason) {
    diagnostics.push(error("STUDIO_TS_SYNTAX_INVALID", reason instanceof Error ? reason.message : "La sintaxis TypeScript no es válida."));
  }
  const forbidden = [
    [/\bimport\s*\(/u, "import dinámico"],
    [/\beval\s*\(/u, "eval"],
    [/\bnew\s+Function\b/u, "Function"],
    [/\b(?:Bun|process|Deno)\s*\./u, "runtime global"],
    [/\b(?:fetch|WebSocket)\s*\(/u, "red"],
  ] as const;
  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) diagnostics.push(error("STUDIO_TS_CAPABILITY_FORBIDDEN", `${label} no está permitido en el Studio público.`));
  }
  if (!/export\s+default\s+(?:defineAgent|definePromptTask|defineAssistant)\s*\(/u.test(source)) {
    diagnostics.push(error("STUDIO_TS_DEFAULT_EXPORT_REQUIRED", "La fuente debe exportar por default una definición Marcus."));
  }
  if (!/from\s+["']@marcus\/sdk["']/u.test(source)) diagnostics.push(error("STUDIO_TS_SDK_REQUIRED", "La fuente debe importar @marcus/sdk."));
  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) diagnostics.push(...typecheckTypescript(source));
  if (diagnostics.length === 0) {
    diagnostics.push({ code: "STUDIO_TS_NOT_EXECUTED", severity: "info", message: "Sintaxis, imports y contrato visibles validados sin importar ni ejecutar el módulo." });
  }
  return diagnostics;
}

function typecheckTypescript(source: string): StudioDiagnostic[] {
  const sourcePath = "/studio-agent.ts";
  const sdkPath = "/marcus-sdk.d.ts";
  const options: ts.CompilerOptions = {
    allowJs: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  };
  const defaultHost = ts.createCompilerHost(options, true);
  const virtual = new Map([[sourcePath, source], [sdkPath, SDK_DECLARATIONS]]);
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: (path) => virtual.has(path) || defaultHost.fileExists(path),
    readFile: (path) => virtual.get(path) ?? defaultHost.readFile(path),
    getSourceFile: (path, languageVersion) => {
      const contents = virtual.get(path);
      return contents === undefined ? defaultHost.getSourceFile(path, languageVersion) : ts.createSourceFile(path, contents, languageVersion, true);
    },
    resolveModuleNames: (names) => names.map((name) => name === "@marcus/sdk" ? {
      resolvedFileName: sdkPath,
      extension: ts.Extension.Dts,
      isExternalLibraryImport: true,
    } : undefined),
    writeFile: () => undefined,
  };
  const program = ts.createProgram([sourcePath, sdkPath], options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === sourcePath)
    .slice(0, 20)
    .map((diagnostic) => {
      const position = diagnostic.file === undefined || diagnostic.start === undefined
        ? undefined
        : diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return {
        code: `STUDIO_TS_${diagnostic.code}`,
        severity: "error" as const,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
        ...(position === undefined ? {} : { line: position.line + 1, column: position.character + 1 }),
      };
    });
}

const SDK_DECLARATIONS = `declare module "@marcus/sdk" {
  export interface Schema<T = unknown> { readonly __type?: T }
  type InferSchema<T> = T extends Schema<infer Value> ? Value : never;
  export const m: {
    string(options?: Record<string, unknown>): Schema<string>;
    number(options?: Record<string, unknown>): Schema<number>;
    integer(options?: Record<string, unknown>): Schema<number>;
    boolean(): Schema<boolean>;
    enum<const T extends readonly string[]>(values: T): Schema<T[number]>;
    array<T>(item: Schema<T>, options?: Record<string, unknown>): Schema<T[]>;
    object<T extends Record<string, Schema>>(shape: T): Schema<{ [K in keyof T]: InferSchema<T[K]> }>;
    optional<T>(value: Schema<T>): Schema<T | undefined>;
  };
  export function definePromptTask<Input, Output>(config: {
    id: string;
    name: string;
    description?: string;
    input: Schema<Input>;
    output: Schema<Output>;
    system: string;
    prompt: (context: { input: Input }) => string;
  }): unknown;
  export function defineAgent(config: Record<string, unknown>): unknown;
  export function defineAssistant(config: Record<string, unknown>): unknown;
}`;

function normalizeSource(source: string): string {
  return `${source.replace(/\r\n?/gu, "\n").trim()}\n`;
}

function error(code: string, message: string): StudioDiagnostic {
  return { code, severity: "error", message };
}

function studioValidationError(code: string, message: string): MarcusError {
  return new MarcusError({ code, message, retryable: false });
}
