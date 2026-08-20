"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clipboard, ExternalLink, LoaderCircle, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { requestBff } from "@/lib/marcus/client";
import type { AgentInputExample, Json } from "@/lib/marcus/types";

type Props = {
  projectId: string;
  agent: string;
  endpoint: string;
  enabled: boolean;
  authentication?: string;
  supported: boolean;
  inputSchema: Json;
};

export function AgentApiAccess({ projectId, agent, endpoint, enabled, authentication, supported, inputSchema }: Props) {
  const router = useRouter();
  const fallback = schemaExample(inputSchema);
  const [busy, setBusy] = useState(false);
  const [exampleBusy, setExampleBusy] = useState(enabled);
  const [example, setExample] = useState<AgentInputExample>({ input: fallback, source: "schema" });
  const [exampleError, setExampleError] = useState<string>();

  const requestExample = useCallback(() => requestBff<AgentInputExample>(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/input-example`, { method: "POST" }), [agent, projectId]);

  const applyExample = useCallback((generated: AgentInputExample) => {
    setExample(generated);
  }, []);

  const generateExample = useCallback(async () => {
    setExampleBusy(true);
    setExampleError(undefined);
    try {
      applyExample(await requestExample());
    } catch (error) {
      setExampleError(error instanceof Error ? error.message : "No se pudo generar el ejemplo con AI.");
    } finally {
      setExampleBusy(false);
    }
  }, [applyExample, requestExample]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void requestExample()
      .then((generated) => { if (active) applyExample(generated); })
      .catch((error: unknown) => { if (active) setExampleError(error instanceof Error ? error.message : "No se pudo generar el ejemplo con AI."); })
      .finally(() => { if (active) setExampleBusy(false); });
    return () => { active = false; };
  }, [applyExample, enabled, requestExample]);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await requestBff(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/api-access`, { method: "PATCH", body: JSON.stringify({ enabled: next }) });
      toast.success(next ? "Acceso API habilitado y nueva versión activada" : "Acceso API deshabilitado y nueva versión activada");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el acceso API.");
    } finally {
      setBusy(false);
    }
  }

  const curl = curlExample(endpoint, authentication, example.input);

  return (
    <Card className="border-border/75 bg-card/55">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div><CardTitle className="flex items-center gap-2"><ExternalLink className="size-4 text-primary" />Acceso por API</CardTitle><CardDescription>Publica una entrada HTTP gobernada por Marcus API.</CardDescription></div>
          <div className="flex items-center gap-3"><Badge variant={enabled ? "default" : "outline"}>{enabled ? "Habilitado" : "Deshabilitado"}</Badge>{busy ? <LoaderCircle className="size-4 animate-spin text-primary" /> : <Switch aria-label="Acceso por API" checked={enabled} disabled={!supported} onCheckedChange={(value) => void toggle(value)} />}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported && <p className="text-sm text-muted-foreground">La activación automática está disponible para agentes Markdown. Este agente usa una fuente SDK.</p>}
        {enabled && (
          <>
            <div><p className="text-xs text-muted-foreground">Endpoint</p><div className="mt-2 flex items-center gap-2 rounded-lg border border-border/70 bg-background/50 p-3"><code className="min-w-0 flex-1 break-all text-xs" data-agent-api-endpoint>{endpoint}</code><Button type="button" variant="ghost" size="icon-sm" aria-label="Copiar endpoint" onClick={() => void navigator.clipboard.writeText(endpoint).then(() => toast.success("Endpoint copiado"))}><Clipboard /></Button></div></div>
            <div><p className="text-xs text-muted-foreground">Autenticación</p><p className="mt-1 text-sm">{authentication === "none" ? "Público" : "Bearer token del Project"}</p></div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">Ejemplo completo</p>
                <p className="truncate text-xs text-muted-foreground" data-agent-input-example-source>
                  {exampleBusy ? "Generando con Marcus AI…" : example.source === "llm" ? `${example.provider} · ${example.model}` : "Derivado del contrato"}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={exampleBusy} onClick={() => void generateExample()}>{exampleBusy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Regenerar</Button>
            </div>
            {exampleError !== undefined && <p className="text-xs text-destructive">{exampleError} Se conserva el ejemplo derivado del contrato.</p>}
            <pre className="overflow-x-auto rounded-lg border border-border/70 bg-background/60 p-4 text-xs leading-6" data-agent-api-curl><code>{curl}</code></pre>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(curl).then(() => toast.success("curl copiado"))}><Clipboard />Copiar curl</Button>
              <Button asChild size="sm"><Link href={`/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/test-case`}><Play />Test case</Link></Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function curlExample(endpoint: string, authentication: string | undefined, input: Json): string {
  const body = JSON.stringify(input, null, 2).replaceAll("'", `'"'"'`);
  const authorization = authentication === "none" ? "" : "  -H 'Authorization: Bearer $MARCUS_TOKEN' \\\n";
  return `curl -X POST '${endpoint}' \\\n${authorization}  -H 'Content-Type: application/json' \\\n  -d '${body}'`;
}

function schemaExample(schema: Json, property = ""): Json {
  if (!isRecord(schema)) return null;
  if ("default" in schema && isJson(schema.default)) return structuredClone(schema.default);
  if ("const" in schema && isJson(schema.const)) return structuredClone(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && isJson(schema.enum[0])) return structuredClone(schema.enum[0]);
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0 && isJson(schema.anyOf[0])) return schemaExample(schema.anyOf[0], property);
  if (schema.type === "object") {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    return Object.fromEntries(Object.entries(properties).map(([key, child]) => [key, isJson(child) ? schemaExample(child, key) : null]));
  }
  if (schema.type === "array") return [isJson(schema.items) ? schemaExample(schema.items, property) : null];
  if (schema.type === "number" || schema.type === "integer") return typeof schema.minimum === "number" ? schema.minimum : 0;
  if (schema.type === "boolean") return false;
  if (schema.type === "null") return null;
  if (/caso|case/iu.test(property)) return "El cliente no puede ingresar a su cuenta desde ayer.";
  if (/mensaje|message|prompt|query|consulta|text/iu.test(property)) return "Necesito ayuda con mi cuenta.";
  return "valor de ejemplo";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJson(item));
  return isRecord(value) && Object.values(value).every((item) => isJson(item));
}
