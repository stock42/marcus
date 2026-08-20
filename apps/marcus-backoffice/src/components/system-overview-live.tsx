"use client";

import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, Bot, CheckCircle2, FolderKanban, Radio, ServerCog } from "lucide-react";
import { useMarcusRealtime } from "@/components/marcus-realtime";
import { RunStatus } from "@/components/run-status";
import { SystemRunsChart } from "@/components/system-runs-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SystemOverview } from "@/lib/marcus/types";

export function SystemOverviewLive({ initial }: { initial: SystemOverview }) {
  const realtime = useMarcusRealtime<SystemOverview>("system.overview", {}, undefined, initial);
  const overview = realtime.data ?? initial;
  const attention = overview.totals.failed24h + overview.totals.pendingApprovals;
  return <div className="mx-auto w-full max-w-[1500px] space-y-8" data-live-surface="system-overview">
    <section className="page-heading">
      <div><p className="eyebrow">Mission control</p><h1>Centro de control</h1><p>Estado operativo, carga, excepciones y actividad reciente de toda la instalación visible.</p></div>
      <div className="flex flex-wrap items-center gap-2"><LiveStamp status={realtime.status} eventAt={realtime.eventAt ?? overview.sampledAt} /><Badge variant="outline" className="border-primary/25 bg-primary/5 text-primary"><span className="mr-2 size-2 rounded-full bg-primary" />{overview.health.status === "ok" ? "Sistema saludable" : "Revisión necesaria"}</Badge></div>
    </section>
    {realtime.error !== undefined && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert"><strong className="font-mono text-destructive">{realtime.error.code}</strong><span className="ml-2">{realtime.error.message}</span><Button variant="ghost" size="sm" onClick={realtime.reconnect}>Reconectar</Button></div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores principales">
      <Metric icon={FolderKanban} label="Projects" value={overview.totals.projects} detail={`${overview.totals.files} archivos administrados`} />
      <Metric icon={Bot} label="Agentes" value={overview.totals.agents} detail={`${overview.totals.activeAgents} activos`} />
      <Metric icon={Activity} label="Runs · 24 h" value={overview.totals.runs24h} detail={`${overview.totals.failed24h} con error`} alert={overview.totals.failed24h > 0} />
      <Metric icon={ServerCog} label="Runtime" value={overview.totals.activeProcesses} detail={`${overview.totals.pendingApprovals} approvals · ${overview.health.realtime?.activeConnections ?? 0} canales MNP`} alert={overview.totals.pendingApprovals > 0} />
    </section>
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.65fr)]">
      <Card className="border-border/75 bg-card/55"><CardHeader><CardTitle>Actividad de agentes</CardTitle><CardDescription>Runs y fallos agregados de los últimos 14 días. El gráfico se actualiza al persistirse eventos de ejecución.</CardDescription></CardHeader><CardContent><SystemRunsChart data={overview.trend} /><p className="sr-only">Resumen textual: {overview.trend.reduce((sum, day) => sum + day.runs, 0)} runs y {overview.trend.reduce((sum, day) => sum + day.failed, 0)} fallidos en el período.</p></CardContent></Card>
      <Card className={attention === 0 ? "border-primary/20 bg-primary/[0.035]" : "border-amber-500/25 bg-amber-500/5"}><CardHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-background/60">{attention === 0 ? <CheckCircle2 className="text-primary" /> : <AlertTriangle className="text-amber-300" />}</div><CardTitle>{attention === 0 ? "Sin pendientes críticos" : `${attention} señales requieren atención`}</CardTitle><CardDescription>Fallos recientes y decisiones humanas abiertas.</CardDescription></CardHeader><CardContent className="space-y-3"><Signal label="Runs con error" value={overview.totals.failed24h} href="/runs" /><Signal label="Approvals pendientes" value={overview.totals.pendingApprovals} href="/runtime" /><Signal label="Base SQLite" value={overview.health.database === "healthy" ? "Saludable" : overview.health.database} href="/runtime" /></CardContent></Card>
    </section>
    <Card className="border-border/75 bg-card/55"><CardHeader><CardTitle>Actividad reciente</CardTitle><CardDescription>Últimos Runs de todos los Projects visibles.</CardDescription><CardAction><Button asChild variant="outline" size="sm"><Link href="/runs">Ver todos<ArrowRight /></Link></Button></CardAction></CardHeader><CardContent className="px-0"><Table><TableHeader><TableRow><TableHead>Agente</TableHead><TableHead>Project</TableHead><TableHead>Estado</TableHead><TableHead>Entrypoint</TableHead><TableHead>Admitido</TableHead><TableHead className="text-right">Detalle</TableHead></TableRow></TableHeader><TableBody>{overview.recentRuns.map((run) => <TableRow key={run.runId}><TableCell><strong>{run.agentName}</strong><p className="font-mono text-[11px] text-muted-foreground">{run.agentSlug}</p></TableCell><TableCell className="font-mono text-xs">{shortId(run.projectId)}</TableCell><TableCell><RunStatus state={run.state} /></TableCell><TableCell><Badge variant="outline">{run.entrypoint}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(run.acceptedAt)}</TableCell><TableCell className="text-right"><Button asChild variant="ghost" size="sm"><Link href={`/runs/${encodeURIComponent(run.projectId)}/${encodeURIComponent(run.runId)}`}>Abrir<ArrowRight /></Link></Button></TableCell></TableRow>)}{overview.recentRuns.length === 0 && <TableRow><TableCell colSpan={6} className="h-36 text-center text-muted-foreground">Todavía no hay actividad de agentes.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
  </div>;
}

export function LiveStamp({ status, eventAt }: { status: string; eventAt?: string }) { return <span className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1 text-[10px] text-muted-foreground" title={eventAt === undefined ? undefined : `Última actualización ${formatDate(eventAt)}`}><Radio className={`size-3 ${status === "online" ? "text-primary" : "text-amber-300"}`} />{status === "online" ? "DATOS EN VIVO" : "RECONECTANDO"}{eventAt === undefined ? "" : ` · ${formatTime(eventAt)}`}</span>; }
function Metric({ icon: Icon, label, value, detail, alert = false }: { icon: typeof FolderKanban; label: string; value: number; detail: string; alert?: boolean }) { return <Card size="sm" className={alert ? "border-amber-500/25 bg-amber-500/5" : "border-border/70 bg-card/45"}><CardHeader><CardDescription>{label}</CardDescription><CardAction><Icon className={alert ? "size-4 text-amber-300" : "size-4 text-primary"} /></CardAction></CardHeader><CardContent><strong className="text-2xl font-semibold tabular-nums">{value}</strong><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>; }
function Signal({ label, value, href }: { label: string; value: string | number; href: string }) { return <Link href={href} className="flex items-center justify-between rounded-lg border border-border/70 bg-background/35 px-3 py-2 text-sm transition hover:border-primary/30"><span>{label}</span><span className="flex items-center gap-2 font-medium">{value}<ArrowRight className="size-3.5 text-muted-foreground" /></span></Link>; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatTime(value: string): string { return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }
function shortId(value: string): string { return value.length <= 18 ? value : `${value.slice(0, 11)}…`; }
