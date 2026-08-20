"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, CheckCircle2, Clock3, RadioTower, TriangleAlert } from "lucide-react";
import { useMarcusRealtime } from "@/components/marcus-realtime";
import { isTerminalRun, RunStatus } from "@/components/run-status";
import { LiveStamp } from "@/components/system-overview-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AgentDefinition, Project, Run } from "@/lib/marcus/types";

export type ProjectRunsSnapshot = { project: Project; runs: Run[]; agents: AgentDefinition[] };

export function RunsLive({ initialProjects, initialSnapshots }: { initialProjects: Project[]; initialSnapshots: ProjectRunsSnapshot[] }) {
  const projectsRealtime = useMarcusRealtime<Project[]>("projects.list", { status: "active" }, undefined, initialProjects);
  const projects = projectsRealtime.data ?? initialProjects;
  const [snapshots, setSnapshots] = useState(() => new Map(initialSnapshots.map((snapshot) => [snapshot.project.projectId, snapshot])));
  const updateSnapshot = useCallback((snapshot: ProjectRunsSnapshot) => setSnapshots((current) => {
    const previous = current.get(snapshot.project.projectId);
    if (previous?.project === snapshot.project && previous.runs === snapshot.runs && previous.agents === snapshot.agents) return current;
    const next = new Map(current);
    next.set(snapshot.project.projectId, snapshot);
    return next;
  }), []);
  const rows = useMemo(() => [...snapshots.values()].flatMap(({ project, runs, agents }) => {
    const byId = new Map(agents.map((agent) => [agent.agentId, agent]));
    return runs.map((run) => ({ run, project, agent: byId.get(run.agentId) }));
  }).sort((left, right) => right.run.acceptedAt.localeCompare(left.run.acceptedAt)), [snapshots]);
  const active = rows.filter(({ run }) => !isTerminalRun(run.state)).length;
  const failed = rows.filter(({ run }) => run.state === "failed" || run.state === "timed_out" || run.state === "killed").length;
  return <div className="mx-auto w-full max-w-[1500px] space-y-8" data-live-surface="runs">
    {projects.map((project) => <ProjectRunsFeed key={project.projectId} project={project} initial={snapshots.get(project.projectId)} onChange={updateSnapshot} />)}
    <section className="page-heading"><div><p className="eyebrow">Runtime activity</p><h1>Runs</h1><p>Ejecuciones recientes de todos los proyectos visibles, con estado y trazabilidad real.</p></div><LiveStamp status={projectsRealtime.status} eventAt={projectsRealtime.eventAt} /></section>
    <section className="grid gap-4 sm:grid-cols-3" aria-label="Resumen de Runs"><Metric icon={RadioTower} label="Total" value={rows.length} detail="Últimos 100 por proyecto" /><Metric icon={Activity} label="En curso" value={active} detail="Aceptados, ejecutando o esperando" /><Metric icon={failed === 0 ? CheckCircle2 : TriangleAlert} label="Con error" value={failed} detail={failed === 0 ? "Sin fallos recientes" : "Requieren revisión"} /></section>
    <Card className="border-border/75 bg-card/55"><CardHeader><CardDescription>Ordenados por fecha de admisión · actualizados por eventos del Kernel</CardDescription><CardAction><Badge variant="outline">{rows.length} Runs</Badge></CardAction></CardHeader><CardContent className="px-0"><Table><TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Proyecto</TableHead><TableHead>Agente</TableHead><TableHead>Estado</TableHead><TableHead>Entrada</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Detalle</TableHead></TableRow></TableHeader><TableBody>{rows.map(({ run, project, agent }) => <TableRow key={run.runId}><TableCell className="font-mono text-xs">{shortId(run.runId)}</TableCell><TableCell><strong>{project.name}</strong><p className="font-mono text-[11px] text-muted-foreground">{project.slug}</p></TableCell><TableCell><strong>{agent?.name ?? shortId(run.agentId)}</strong>{agent !== undefined && <p className="font-mono text-[11px] text-muted-foreground">{agent.slug}</p>}</TableCell><TableCell><RunStatus state={run.state} /></TableCell><TableCell><Badge variant="outline">{run.entrypoint}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground"><Clock3 className="mr-1 inline size-3" />{formatDate(run.acceptedAt)}</TableCell><TableCell className="text-right"><Button asChild variant="ghost" size="sm"><Link href={`/runs/${encodeURIComponent(project.projectId)}/${encodeURIComponent(run.runId)}`}>Abrir<ArrowUpRight /></Link></Button></TableCell></TableRow>)}{rows.length === 0 && <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted-foreground">Todavía no hay Runs registrados.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
  </div>;
}

function ProjectRunsFeed({ project, initial, onChange }: { project: Project; initial?: ProjectRunsSnapshot; onChange(snapshot: ProjectRunsSnapshot): void }) {
  const runs = useMarcusRealtime<Run[]>("runs.list", { limit: 100 }, project.projectId, initial?.runs ?? []);
  const agents = useMarcusRealtime<AgentDefinition[]>("agents.list", {}, project.projectId, initial?.agents ?? []);
  useEffect(() => onChange({ project, runs: runs.data ?? [], agents: agents.data ?? [] }), [agents.data, project, runs.data, onChange]);
  return null;
}
function Metric({ icon: Icon, label, value, detail }: { icon: typeof RadioTower; label: string; value: number; detail: string }) { return <Card size="sm" className="border border-border/70 bg-card/45"><CardHeader><CardDescription>{label}</CardDescription><CardAction><Icon className="size-4 text-primary" /></CardAction></CardHeader><CardContent><strong className="text-2xl font-semibold tabular-nums">{value}</strong><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>; }
function shortId(value: string): string { return value.length <= 20 ? value : `${value.slice(0, 12)}…${value.slice(-6)}`; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
