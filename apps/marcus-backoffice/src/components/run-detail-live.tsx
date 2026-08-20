"use client";

import Link from "next/link";
import { Activity, ArrowLeft, Bot, Clock3, Fingerprint, Route } from "lucide-react";
import { CancelRunButton } from "@/components/cancel-run-button";
import { useMarcusRealtime } from "@/components/marcus-realtime";
import { isTerminalRun, RunStatus } from "@/components/run-status";
import { LiveStamp } from "@/components/system-overview-live";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentDefinition, Project, Run } from "@/lib/marcus/types";

export function RunDetailLive({ initial, project, agent }: { initial: Run; project?: Project; agent?: AgentDefinition }) {
  const realtime = useMarcusRealtime<Run>("runs.get", { runId: initial.runId }, initial.projectId, initial);
  const run = realtime.data ?? initial;
  const terminal = isTerminalRun(run.state);
  return <div className="mx-auto w-full max-w-[1300px] space-y-8" data-live-surface="run-detail">
    <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href="/runs">Runs</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{run.runId}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
    <section className="page-heading"><div><p className="eyebrow">{project?.name ?? run.projectId}</p><h1 className="break-all font-mono text-2xl">{run.runId}</h1><p>Detalle operativo, resultado y trazas de la ejecución.</p></div><div className="flex flex-wrap items-center gap-2"><LiveStamp status={realtime.status} eventAt={realtime.eventAt} /><Button asChild variant="outline"><Link href="/runs"><ArrowLeft />Volver</Link></Button>{!terminal && <CancelRunButton projectId={run.projectId} runId={run.runId} />}</div></section>
    {realtime.error !== undefined && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert"><strong className="font-mono text-destructive">{realtime.error.code}</strong> · {realtime.error.message}</p>}
    <section className="grid gap-4 md:grid-cols-4"><Fact icon={Activity} label="Estado" value={<RunStatus state={run.state} />} /><Fact icon={Bot} label="Agente" value={agent?.name ?? run.agentId} /><Fact icon={Route} label="Entrypoint" value={<Badge variant="outline">{run.entrypoint}</Badge>} /><Fact icon={Clock3} label="Duración" value={duration(run)} /></section>
    <section className="grid gap-6 lg:grid-cols-2"><JsonCard title="Output" description="Respuesta persistida por el Kernel" value={run.output} empty="El Run todavía no produjo output." /><JsonCard title="Error" description="Error tipado y seguro" value={run.error} empty="No hay error registrado." /></section>
    <Card className="border-border/75 bg-card/55"><CardHeader><CardTitle>Trazabilidad</CardTitle><CardDescription>Identificadores para correlacionar eventos y logs.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><Trace label="Trace ID" value={run.traceId} /><Trace label="Correlation ID" value={run.correlationId} /><Trace label="Agent Version" value={run.agentVersionId} /><Trace label="Project ID" value={run.projectId} /></CardContent></Card>
  </div>;
}
function Fact({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: React.ReactNode }) { return <Card size="sm" className="border-border/70 bg-card/45"><CardHeader><CardDescription>{label}</CardDescription><CardAction><Icon className="size-4 text-primary" /></CardAction></CardHeader><CardContent><div className="font-medium">{value}</div></CardContent></Card>; }
function JsonCard({ title, description, value, empty }: { title: string; description: string; value: unknown; empty: string }) { return <Card className="border-border/75 bg-card/55"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{value === undefined ? <p className="text-sm text-muted-foreground">{empty}</p> : <pre className="whitespace-pre-wrap break-all rounded-lg border border-border/70 bg-background/70 p-4 text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>}</CardContent></Card>; }
function Trace({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-lg border border-border/60 p-3"><div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Fingerprint className="size-3" />{label}</div><p className="truncate font-mono text-xs" title={value}>{value}</p></div>; }
function duration(run: Run): string { const start = Date.parse(run.startedAt ?? run.acceptedAt); const end = Date.parse(run.finishedAt ?? new Date().toISOString()); const milliseconds = Math.max(0, end - start); return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(1)} s`; }
