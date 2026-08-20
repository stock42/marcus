"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Braces, Clipboard, LoaderCircle, Play, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useMarcusRealtime } from "@/components/marcus-realtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MarcusBffError, requestBff } from "@/lib/marcus/client";
import type { AgentInputExample, Json, Run } from "@/lib/marcus/types";

type Props = {
  projectId: string;
  agent: string;
  endpoint: string;
  authentication?: string;
  inputSchema: Json;
  outputSchema: Json;
};

type TestResponse =
  | { ok: true; data: Json }
  | { ok: false; error: { code: string; message: string } };

type PendingRun = {
  runId: string;
  state: Run["state"];
  status: "processing";
};

export function AgentApiTestCase({ projectId, agent, endpoint, authentication, inputSchema, outputSchema }: Props) {
  const [example, setExample] = useState<AgentInputExample>();
  const [exampleBusy, setExampleBusy] = useState(true);
  const [exampleError, setExampleError] = useState<string>();
  const [testBody, setTestBody] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResponse, setTestResponse] = useState<TestResponse>();
  const [testProgress, setTestProgress] = useState<{ runId: string; state: Run["state"] }>();
  const activeRunId = testProgress?.runId;
  const canTestWithSession = authentication === "none" || authentication === "marcus-token";

  const handleRun = useCallback((run: Run) => {
    if (activeRunId === undefined || run.runId !== activeRunId) return;
    setTestProgress({ runId: run.runId, state: run.state });
    if (!terminalRunStates.has(run.state)) return;
    setTestBusy(false);
    if (run.state === "completed") setTestResponse({ ok: true, data: run.output ?? null });
    else setTestResponse({ ok: false, error: run.error ?? { code: "RUN_FAILED", message: `La ejecución terminó con estado ${run.state}.` } });
  }, [activeRunId]);

  const handleRunError = useCallback((error: { code: string; message: string }) => {
    if (activeRunId === undefined) return;
    setTestBusy(false);
    setTestResponse({ ok: false, error: { code: error.code, message: error.message } });
  }, [activeRunId]);

  useMarcusRealtime<Run>("runs.get", { runId: activeRunId ?? "inactive" }, projectId, undefined, activeRunId !== undefined, { onData: handleRun, onError: handleRunError });

  const loadExample = useCallback(async () => {
    setExampleBusy(true);
    setExampleError(undefined);
    try {
      const generated = await requestBff<AgentInputExample>(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/input-example`, { method: "POST" });
      setExample(generated);
      setTestBody(JSON.stringify(generated.input, null, 2));
      setTestProgress(undefined);
      setTestResponse(undefined);
    } catch (error) {
      setExampleError(error instanceof Error ? error.message : "No se pudo generar un ejemplo desde el contrato activo.");
    } finally {
      setExampleBusy(false);
    }
  }, [agent, projectId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const generated = await requestBff<AgentInputExample>(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/input-example`, { method: "POST" });
        if (!active) return;
        setExample(generated);
        setTestBody(JSON.stringify(generated.input, null, 2));
      } catch (error) {
        if (active) setExampleError(error instanceof Error ? error.message : "No se pudo generar un ejemplo desde el contrato activo.");
      } finally {
        if (active) setExampleBusy(false);
      }
    })();
    return () => { active = false; };
  }, [agent, projectId]);

  async function runTestCase() {
    let waitingForRealtime = false;
    let input: unknown;
    try {
      input = JSON.parse(testBody);
    } catch {
      setTestResponse({ ok: false, error: { code: "JSON_INVALID", message: "El input no contiene JSON válido." } });
      return;
    }
    setTestBusy(true);
    setTestResponse(undefined);
    setTestProgress(undefined);
    try {
      const data = await requestBff<Json>(`/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/test-case`, {
        method: "POST",
        headers: { Prefer: "respond-async" },
        body: JSON.stringify({ input }),
      });
      if (isPendingRun(data)) {
        setTestProgress({ runId: data.runId, state: data.state });
        waitingForRealtime = true;
      } else {
        setTestResponse({ ok: true, data });
      }
    } catch (error) {
      setTestResponse({
        ok: false,
        error: error instanceof MarcusBffError
          ? { code: error.code, message: error.message }
          : { code: "TEST_CASE_FAILED", message: error instanceof Error ? error.message : "No se pudo ejecutar el agente." },
      });
    } finally {
      if (!waitingForRealtime) setTestBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
      <div className="space-y-5">
        <Card className="border-border/75 bg-card/55">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle>Input JSON</CardTitle>
                <CardDescription>El editor se inicializa con un ejemplo completo generado desde el contrato activo.</CardDescription>
              </div>
              {example !== undefined && (
                <Badge variant="outline" data-agent-input-example-source>
                  <Sparkles className="size-3" />
                  {example.source === "llm" ? `${example.provider} · ${example.model}` : "Derivado del contrato"}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {exampleBusy && example === undefined ? (
              <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-primary/30 bg-primary/[0.025] p-8 text-center" data-agent-example-loading>
                <div className="space-y-3"><LoaderCircle className="mx-auto size-6 animate-spin text-primary" /><div><p className="font-medium">Preparando un caso válido</p><p className="text-sm text-muted-foreground">Marcus analiza el contrato activo y genera datos sintéticos de ejemplo.</p></div></div>
              </div>
            ) : example === undefined ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5" role="alert">
                <div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" /><div className="space-y-3"><div><p className="font-medium">No se pudo preparar el input</p><p className="text-sm text-muted-foreground">{exampleError}</p></div><Button type="button" variant="outline" size="sm" onClick={() => void loadExample()}><RotateCcw />Reintentar</Button></div></div>
              </div>
            ) : (
              <>
                <Textarea
                  aria-label="Input JSON del test case"
                  className="min-h-96 resize-y font-mono text-xs leading-6"
                  spellCheck={false}
                  value={testBody}
                  onChange={(event) => setTestBody(event.target.value)}
                />
                {exampleError !== undefined && <p className="text-sm text-destructive">{exampleError}</p>}
                {!canTestWithSession && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Este contrato requiere credenciales externas. El Backoffice sólo puede probar entradas públicas o autenticadas con token Marcus.</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" disabled={!canTestWithSession || testBusy || exampleBusy} onClick={() => void runTestCase()}>{testBusy ? <LoaderCircle className="animate-spin" /> : <Play />}{testBusy ? "Ejecutando…" : "Probar agente"}</Button>
                  <Button type="button" variant="outline" disabled={exampleBusy || testBusy} onClick={() => void loadExample()}>{exampleBusy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Generar otro ejemplo</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {testProgress !== undefined && (
          <Card className="border-primary/25 bg-primary/[0.035]" data-agent-test-progress>
            <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle className="text-base">{runStateMessage(testProgress.state)}</CardTitle><CardDescription>El resultado llegará por el canal WebSocket activo.</CardDescription></div><Badge variant="outline">{testProgress.state}</Badge></div></CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3"><code className="break-all text-xs text-muted-foreground">{testProgress.runId}</code><Button asChild variant="outline" size="sm"><Link href={`/runs/${encodeURIComponent(projectId)}/${encodeURIComponent(testProgress.runId)}`}>Abrir Run</Link></Button></CardContent>
          </Card>
        )}

        {testResponse !== undefined && (
          <Card className={testResponse.ok ? "border-primary/25" : "border-destructive/30"} data-agent-test-response>
            <CardHeader><CardTitle className="text-base">{testResponse.ok ? "Respuesta del agente" : "La ejecución falló"}</CardTitle><CardDescription>{testResponse.ok ? "Salida entregada por la versión activa." : `${testResponse.error.code} · ${testResponse.error.message}`}</CardDescription></CardHeader>
            <CardContent><pre className="overflow-x-auto rounded-lg border border-border/70 bg-background/60 p-4 text-xs leading-6"><code>{JSON.stringify(testResponse, null, 2)}</code></pre></CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <Card className="border-border/75 bg-card/55">
          <CardHeader><CardTitle className="flex items-center gap-2"><Braces className="size-4 text-primary" />Contrato activo</CardTitle><CardDescription>La entrada editable y la salida esperada pertenecen a la versión actualmente activada.</CardDescription></CardHeader>
          <CardContent className="space-y-5"><ContractSchema title="Entrada" schema={inputSchema} /><ContractSchema title="Salida" schema={outputSchema} /></CardContent>
        </Card>
        <Card className="border-border/75 bg-card/45">
          <CardHeader><CardTitle className="text-base">Endpoint ejecutado</CardTitle><CardDescription>Es el mismo endpoint público documentado en el ejemplo curl.</CardDescription></CardHeader>
          <CardContent><div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/50 p-3"><code className="min-w-0 flex-1 break-all text-xs">POST {endpoint}</code><Button type="button" variant="ghost" size="icon-sm" aria-label="Copiar endpoint" onClick={() => void navigator.clipboard.writeText(endpoint).then(() => toast.success("Endpoint copiado"))}><Clipboard /></Button></div></CardContent>
        </Card>
      </div>
    </div>
  );
}

function ContractSchema({ title, schema }: { title: string; schema: Json }) {
  return <section><p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p><pre className="overflow-x-auto rounded-lg border border-border/70 bg-background/60 p-4 text-xs leading-6"><code>{JSON.stringify(schema, null, 2)}</code></pre></section>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPendingRun(value: unknown): value is PendingRun {
  return isRecord(value) && typeof value.runId === "string" && typeof value.state === "string" && value.status === "processing";
}

const terminalRunStates = new Set<Run["state"]>(["completed", "failed", "cancelled", "timed_out", "killed"]);

function runStateMessage(state: Run["state"]): string {
  if (state === "queued" || state === "accepted") return "Ejecución aceptada; esperando un Runtime disponible.";
  if (state === "starting") return "Iniciando el Runtime del agente.";
  if (state === "running") return "El agente está procesando el caso.";
  if (state === "waiting_for_approval") return "El agente espera una aprobación humana.";
  if (state === "waiting_for_input") return "El agente espera información adicional.";
  if (state === "waiting_for_child") return "El agente espera la respuesta de otro agente.";
  if (state === "completed") return "Ejecución completada.";
  return `Ejecución finalizada: ${state}.`;
}
