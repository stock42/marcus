"use client";

import { Activity, Bot, FileCode2, Layers3 } from "lucide-react";
import { useMarcusRealtime } from "@/components/marcus-realtime";
import { ProjectRunsChart } from "@/components/project-runs-chart";
import { LiveStamp } from "@/components/system-overview-live";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Project, ProjectDashboard } from "@/lib/marcus/types";

export function ProjectDashboardLive({ project, initial }: { project: Project; initial: ProjectDashboard }) {
  const realtime = useMarcusRealtime<ProjectDashboard>("projects.dashboard", {}, project.projectId, initial);
  const dashboard = realtime.data ?? initial;
  return <div className="space-y-6" data-live-surface="project-dashboard">
    <div className="flex justify-end"><LiveStamp status={realtime.status} eventAt={realtime.eventAt} /></div>
    {realtime.error !== undefined && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert"><strong className="font-mono text-destructive">{realtime.error.code}</strong> · {realtime.error.message}</p>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumen del proyecto">
      <Metric icon={Bot} label="Agentes" value={dashboard.agents} detail={`${dashboard.activeAgents} activos · ${dashboard.apiAgents} por API`} />
      <Metric icon={FileCode2} label="Archivos" value={dashboard.files} detail="Total del Project Home" />
      <Metric icon={Activity} label="Runs" value={dashboard.runs} detail="Últimos 30 días" />
      <Metric icon={Layers3} label="Estado" value={project.status === "active" ? "Activo" : "Archivado"} detail="Gobernado por marcusd" />
    </section>
    <Card className="border-border/75 bg-card/55"><CardHeader><CardTitle>Consumo de agentes</CardTitle><CardDescription>Runs diarios y fallos registrados durante los últimos 30 días; actualización dirigida por eventos.</CardDescription></CardHeader><CardContent><ProjectRunsChart data={dashboard.consumption} /><p className="sr-only">Resumen textual: {dashboard.consumption.reduce((sum, day) => sum + day.runs, 0)} runs y {dashboard.consumption.reduce((sum, day) => sum + day.failed, 0)} fallidos.</p></CardContent></Card>
  </div>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Bot; label: string; value: string | number; detail: string }) { return <Card size="sm" className="border-border/70 bg-card/45"><CardHeader><CardDescription>{label}</CardDescription><CardAction><Icon className="size-4 text-primary" /></CardAction></CardHeader><CardContent><strong className="text-2xl font-semibold tabular-nums">{value}</strong><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>; }
