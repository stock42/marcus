"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock3, ServerCog, ShieldQuestion } from "lucide-react";
import { useMarcusRealtime } from "@/components/marcus-realtime";
import { RuntimeControl } from "@/components/runtime-control";
import { LiveStamp } from "@/components/system-overview-live";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { AgentSchedule, Approval, Project, RuntimeProcess } from "@/lib/marcus/types";

export type RuntimeSnapshot = { project: Project; processes: RuntimeProcess[]; approvals: Approval[]; schedules: AgentSchedule[] };
type Scoped<T> = T & { project: Project };

export function RuntimeLive({ initialProjects, initialSnapshots }: { initialProjects: Project[]; initialSnapshots: RuntimeSnapshot[] }) {
  const projectsRealtime = useMarcusRealtime<Project[]>("projects.list", { status: "active" }, undefined, initialProjects);
  const projects = projectsRealtime.data ?? initialProjects;
  const [snapshots, setSnapshots] = useState(() => new Map(initialSnapshots.map((snapshot) => [snapshot.project.projectId, snapshot])));
  const update = useCallback((snapshot: RuntimeSnapshot) => setSnapshots((current) => { const previous = current.get(snapshot.project.projectId); if (previous?.project === snapshot.project && previous.processes === snapshot.processes && previous.approvals === snapshot.approvals && previous.schedules === snapshot.schedules) return current; const next = new Map(current); next.set(snapshot.project.projectId, snapshot); return next; }), []);
  const data = useMemo(() => {
    const values = [...snapshots.values()];
    return {
      processes: values.flatMap(({ project, processes }) => processes.map((entry) => ({ ...entry, project }))) as Array<Scoped<RuntimeProcess>>,
      approvals: values.flatMap(({ project, approvals }) => approvals.map((entry) => ({ ...entry, project }))) as Array<Scoped<Approval>>,
      schedules: values.flatMap(({ project, schedules }) => schedules.map((entry) => ({ ...entry, project }))) as Array<Scoped<AgentSchedule>>,
    };
  }, [snapshots]);
  return <div className="mx-auto w-full max-w-[1500px] space-y-8" data-live-surface="runtime">
    {projects.map((project) => <RuntimeFeed key={project.projectId} project={project} initial={snapshots.get(project.projectId)} onChange={update} />)}
    <section className="page-heading"><div><p className="eyebrow">Runtime operations</p><h1>Runtime</h1><p>Procesos activos, decisiones humanas y schedules de todos los Projects visibles.</p></div><LiveStamp status={projectsRealtime.status} eventAt={projectsRealtime.eventAt} /></section>
    <section className="grid gap-4 sm:grid-cols-3"><Metric icon={ServerCog} label="Procesos activos" value={data.processes.length} /><Metric icon={ShieldQuestion} label="Approvals pendientes" value={data.approvals.length} alert={data.approvals.length > 0} /><Metric icon={Clock3} label="Schedules" value={data.schedules.length} /></section>
    <RuntimeControl processes={data.processes} approvals={data.approvals} schedules={data.schedules} />
  </div>;
}

function RuntimeFeed({ project, initial, onChange }: { project: Project; initial?: RuntimeSnapshot; onChange(snapshot: RuntimeSnapshot): void }) {
  const processes = useMarcusRealtime<RuntimeProcess[]>("processes.list", { includeTerminal: false }, project.projectId, initial?.processes ?? []);
  const approvals = useMarcusRealtime<Approval[]>("approvals.list", { status: "pending", limit: 100 }, project.projectId, initial?.approvals ?? []);
  const schedules = useMarcusRealtime<AgentSchedule[]>("schedules.list", {}, project.projectId, initial?.schedules ?? []);
  useEffect(() => onChange({ project, processes: processes.data ?? [], approvals: approvals.data ?? [], schedules: schedules.data ?? [] }), [approvals.data, onChange, processes.data, project, schedules.data]);
  return null;
}
function Metric({ icon: Icon, label, value, alert = false }: { icon: typeof ServerCog; label: string; value: number; alert?: boolean }) { return <Card size="sm" className={alert ? "border-amber-500/25 bg-amber-500/5" : "border-border/70 bg-card/45"}><CardHeader><CardDescription>{label}</CardDescription><CardAction>{alert ? <AlertTriangle className="size-4 text-amber-300" /> : <Icon className="size-4 text-primary" />}</CardAction></CardHeader><CardContent><strong className="text-2xl font-semibold tabular-nums">{value}</strong></CardContent></Card>; }
