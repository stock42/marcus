"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Clock3, LoaderCircle, Play, ServerCog, ShieldQuestion, Square, X } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestBff } from "@/lib/marcus/client";
import type { AgentSchedule, Approval, Project, RuntimeProcess } from "@/lib/marcus/types";

type Scoped<T> = T & { project: Project };
type PendingAction =
  | { kind: "approve"; approval: Scoped<Approval> }
  | { kind: "reject"; approval: Scoped<Approval> }
  | { kind: "kill"; process: Scoped<RuntimeProcess> }
  | { kind: "trigger"; schedule: Scoped<AgentSchedule> };

export function RuntimeControl({ processes, approvals, schedules }: { processes: Array<Scoped<RuntimeProcess>>; approvals: Array<Scoped<Approval>>; schedules: Array<Scoped<AgentSchedule>> }) {
  const [pending, setPending] = useState<PendingAction>();
  const [busy, setBusy] = useState(false);

  async function execute() {
    if (pending === undefined) return;
    setBusy(true);
    try {
      if (pending.kind === "approve" || pending.kind === "reject") {
        await requestBff(`/api/projects/${encodeURIComponent(pending.approval.project.projectId)}/approvals/${encodeURIComponent(pending.approval.approvalId)}`, { method: "POST", body: JSON.stringify({ decision: pending.kind }) });
        toast.success(pending.kind === "approve" ? "Approval aprobada" : "Approval rechazada");
      } else if (pending.kind === "kill") {
        await requestBff(`/api/projects/${encodeURIComponent(pending.process.project.projectId)}/processes/${encodeURIComponent(pending.process.mpid)}/kill`, { method: "POST" });
        toast.success("Proceso terminado");
      } else {
        await requestBff(`/api/projects/${encodeURIComponent(pending.schedule.project.projectId)}/schedules/${encodeURIComponent(pending.schedule.id)}/trigger`, { method: "POST", body: JSON.stringify({ agent: pending.schedule.agent, ...(pending.schedule.input === undefined ? {} : { input: pending.schedule.input }) }) });
        toast.success("Schedule disparado");
      }
      setPending(undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo ejecutar la acción.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Tabs defaultValue={approvals.length > 0 ? "approvals" : "processes"} className="gap-6">
      <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto border-b border-border/70 pb-1"><TabsTrigger value="processes"><ServerCog />Procesos <Badge variant="outline">{processes.length}</Badge></TabsTrigger><TabsTrigger value="approvals"><ShieldQuestion />Approvals <Badge variant={approvals.length > 0 ? "default" : "outline"}>{approvals.length}</Badge></TabsTrigger><TabsTrigger value="schedules"><Clock3 />Schedules <Badge variant="outline">{schedules.length}</Badge></TabsTrigger></TabsList>
      <TabsContent value="processes"><Card className="border-border/75 bg-card/55"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>MPID</TableHead><TableHead>Project</TableHead><TableHead>Tipo</TableHead><TableHead>Estado</TableHead><TableHead>Salud</TableHead><TableHead>Inicio</TableHead><TableHead className="text-right">Control</TableHead></TableRow></TableHeader><TableBody>{processes.map((process) => <TableRow key={`${process.project.projectId}-${process.mpid}`}><TableCell className="font-mono text-xs">{process.mpid}</TableCell><TableCell><Link className="font-medium hover:text-primary" href={`/projects/${encodeURIComponent(process.project.projectId)}`}>{process.project.name}</Link></TableCell><TableCell><Badge variant="outline">{process.processType}</Badge></TableCell><TableCell>{process.state}</TableCell><TableCell><Badge variant={process.health === "healthy" ? "default" : "outline"}>{process.health}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(process.startedAt)}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setPending({ kind: "kill", process })}><Square />Terminar</Button></TableCell></TableRow>)}{processes.length === 0 && <EmptyRow columns={7} text="No hay procesos activos." />}</TableBody></Table></CardContent></Card></TabsContent>
      <TabsContent value="approvals"><Card className="border-border/75 bg-card/55"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Solicitud</TableHead><TableHead>Project</TableHead><TableHead>Acción</TableHead><TableHead>Run</TableHead><TableHead>Solicitada</TableHead><TableHead className="text-right">Decisión</TableHead></TableRow></TableHeader><TableBody>{approvals.map((approval) => <TableRow key={approval.approvalId}><TableCell className="max-w-xl"><strong className="block text-sm">{approval.prompt}</strong><span className="font-mono text-[11px] text-muted-foreground">{approval.approvalId}</span></TableCell><TableCell>{approval.project.name}</TableCell><TableCell><Badge variant="outline">{approval.action}</Badge></TableCell><TableCell><Button asChild variant="link" size="sm" className="px-0 font-mono text-xs"><Link href={`/runs/${encodeURIComponent(approval.project.projectId)}/${encodeURIComponent(approval.runId)}`}>{shortId(approval.runId)}</Link></Button></TableCell><TableCell className="text-xs text-muted-foreground">{formatDate(approval.requestedAt)}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => setPending({ kind: "reject", approval })}><X />Rechazar</Button><Button size="sm" onClick={() => setPending({ kind: "approve", approval })}><Check />Aprobar</Button></div></TableCell></TableRow>)}{approvals.length === 0 && <EmptyRow columns={6} text="No hay approvals pendientes." />}</TableBody></Table></CardContent></Card></TabsContent>
      <TabsContent value="schedules"><Card className="border-border/75 bg-card/55"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Schedule</TableHead><TableHead>Project</TableHead><TableHead>Agente</TableHead><TableHead>Cron</TableHead><TableHead>Timezone</TableHead><TableHead className="text-right">Control</TableHead></TableRow></TableHeader><TableBody>{schedules.map((schedule) => <TableRow key={`${schedule.project.projectId}-${schedule.agentId}-${schedule.id}`}><TableCell className="font-medium">{schedule.id}</TableCell><TableCell>{schedule.project.name}</TableCell><TableCell><Link className="hover:text-primary" href={`/projects/${encodeURIComponent(schedule.project.projectId)}/agents/${encodeURIComponent(schedule.agent)}`}>{schedule.agent}</Link></TableCell><TableCell className="font-mono text-xs">{schedule.cron}</TableCell><TableCell>{schedule.timezone}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => setPending({ kind: "trigger", schedule })}><Play />Disparar</Button></TableCell></TableRow>)}{schedules.length === 0 && <EmptyRow columns={6} text="No hay schedules declarados." />}</TableBody></Table></CardContent></Card></TabsContent>
    </Tabs>
    <AlertDialog open={pending !== undefined} onOpenChange={(open) => !open && !busy && setPending(undefined)}><AlertDialogContent><AlertDialogHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300"><AlertTriangle /></div><AlertDialogTitle>{pendingTitle(pending)}</AlertDialogTitle><AlertDialogDescription>{pendingDescription(pending)}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void execute(); }} disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Confirmar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

function EmptyRow({ columns, text }: { columns: number; text: string }) { return <TableRow><TableCell colSpan={columns} className="h-36 text-center text-muted-foreground">{text}</TableCell></TableRow>; }
function pendingTitle(action: PendingAction | undefined): string { if (action?.kind === "approve") return "Aprobar la acción"; if (action?.kind === "reject") return "Rechazar la acción"; if (action?.kind === "kill") return "Terminar el proceso"; return "Disparar el schedule"; }
function pendingDescription(action: PendingAction | undefined): string { if (action?.kind === "approve" || action?.kind === "reject") return `${action.kind === "approve" ? "Aprobar" : "Rechazar"} ${action.approval.approvalId} reanudará o finalizará el Run asociado.`; if (action?.kind === "kill") return `Marcus terminará ${action.process.mpid} y actualizará el Run o instancia relacionada.`; if (action?.kind === "trigger") return `Marcus ejecutará ${action.schedule.agent} usando el schedule ${action.schedule.id}.`; return "Revisá el objetivo antes de confirmar."; }
function formatDate(value: string): string { return new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function shortId(value: string): string { return value.length < 18 ? value : `${value.slice(0, 12)}…`; }
