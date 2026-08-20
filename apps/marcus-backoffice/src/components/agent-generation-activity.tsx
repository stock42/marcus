"use client";

import { Brain, CheckCircle2, FileCog, LoaderCircle, Sparkles, TerminalSquare, TriangleAlert, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useMarcusRealtime } from "@/components/marcus-realtime";
import type { AgentActivity, AgentGenerationProgress, Json } from "@/lib/marcus/types";

export type AgentGenerationFailure = { code: string; message: string };

export function initialAgentGenerationProgress(progressId: string): AgentGenerationProgress {
  const now = new Date().toISOString();
  const message = "Enviando la descripción y preparando el contrato del agente…";
  return {
    activityId: progressId,
    activityKind: "agent.generate",
    progressId,
    projectId: "",
    status: "running",
    stage: "analyzing",
    message,
    sequence: 0,
    startedAt: now,
    updatedAt: now,
    events: [{
      sequence: 0,
      timestamp: now,
      stage: "analyzing",
      kind: "analysis",
      title: "Preparación del pedido",
      message,
      operation: "requirements.prepare",
    }],
  };
}

export function useAgentActivity<T extends Json>(activityId: string | undefined, projectId?: string, initialData?: AgentActivity<T>, onData?: (activity: AgentActivity<T>) => void, onError?: (error: AgentGenerationFailure) => void) {
  return useMarcusRealtime<AgentActivity<T>>(
    "agentActivities.get",
    { activityId: activityId ?? "inactive" },
    projectId,
    initialData,
    activityId !== undefined,
    { onData, onError },
  );
}

export function AgentGenerationActivity({ progress, failure }: { progress: AgentGenerationProgress; failure?: AgentGenerationFailure }) {
  const detail = progress.error ?? failure;
  const statusLabel = progress.status === "completed" ? "Completado" : progress.status === "failed" || detail !== undefined ? "Error" : "En curso";
  const title = progress.activityKind === "agent.plan" ? "Actividad de planificación" : progress.activityKind === "assistant.chat" ? "Actividad de Marcus AI" : "Actividad de generación";
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background/55" data-agent-generation-activity aria-labelledby="agent-generation-activity-title" role="status">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/25 px-4 py-3">
        <div><h3 id="agent-generation-activity-title" className="flex items-center gap-2 text-sm font-semibold"><TerminalSquare className="size-4 text-primary" />{title}</h3><p className="mt-1 text-xs text-muted-foreground">Resumen operativo, proveedor, compilador y tools ejecutadas por Marcus.</p></div>
        <Badge variant={statusLabel === "Error" ? "destructive" : statusLabel === "Completado" ? "default" : "outline"}>{statusLabel === "En curso" && <LoaderCircle className="animate-spin" />}{statusLabel}</Badge>
      </header>
      <ol className="divide-y divide-border/70" role="log" aria-live="polite" aria-relevant="additions">
        {progress.events.map((event, index) => {
          const current = index === progress.events.length - 1 && progress.status === "running";
          return <li key={`${event.sequence}-${event.operation}`} className="grid gap-3 px-4 py-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto]">
            <span className="mt-0.5 flex size-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">{current ? <LoaderCircle className="size-3.5 animate-spin text-primary" /> : <ActivityIcon kind={event.kind} />}</span>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><strong className="text-xs font-semibold text-foreground">{event.title}</strong><code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{event.operation}</code>{event.provider !== undefined && <span className="text-[10px] text-muted-foreground">{event.provider}{event.model === undefined ? "" : ` · ${event.model}`}</span>}</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{event.message}</p></div>
            <time className="font-mono text-[10px] text-muted-foreground" dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
          </li>;
        })}
      </ol>
      {detail !== undefined && <div className="border-t border-destructive/30 bg-destructive/10 px-4 py-3 text-xs" role="alert" data-agent-generation-error><strong className="font-mono text-destructive">{detail.code}</strong><p className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-foreground">{detail.message}</p></div>}
    </section>
  );
}

function ActivityIcon({ kind }: { kind: AgentGenerationProgress["events"][number]["kind"] }) {
  const Icon = kind === "analysis" ? Brain : kind === "provider" ? Sparkles : kind === "compiler" ? FileCog : kind === "tool" ? Wrench : kind === "error" ? TriangleAlert : CheckCircle2;
  return <Icon className={kind === "error" ? "size-3.5 text-destructive" : kind === "result" ? "size-3.5 text-primary" : "size-3.5"} />;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
