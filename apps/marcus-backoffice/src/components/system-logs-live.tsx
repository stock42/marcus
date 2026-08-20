"use client";

import { ScrollText } from "lucide-react";
import { useMarcusRealtime } from "@/components/marcus-realtime";
import { LiveStamp } from "@/components/system-overview-live";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Json, SystemLogEntry, SystemLogs } from "@/lib/marcus/types";

export function SystemLogsLive({ initial, filters }: { initial: SystemLogs; filters: { q?: string; source?: string; level?: string } }) {
  const payload = { limit: 300, ...(filters.q === undefined || filters.q === "" ? {} : { q: filters.q }), ...(filters.source === undefined || filters.source === "all" ? {} : { source: filters.source }), ...(filters.level === undefined || filters.level === "all" ? {} : { level: filters.level }) };
  const realtime = useMarcusRealtime<SystemLogs>("system.logs", payload, undefined, initial);
  const logs = realtime.data ?? initial;
  return <div className="space-y-3" data-live-surface="system-logs">
    {logs.truncated && <p className="text-xs text-amber-300">El archivo supera la ventana de lectura; se muestra el tail más reciente.</p>}
    {realtime.error !== undefined && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm" role="alert"><strong className="font-mono text-destructive">{realtime.error.code}</strong> · {realtime.error.message}</p>}
    <Card className="overflow-hidden border-border/75 bg-card/55"><CardHeader className="border-b border-border/60"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><ScrollText className="size-4 text-primary" />{logs.entries.length} eventos</CardTitle><CardDescription>Muestreados {formatDate(logs.sampledAt)} · más recientes primero.</CardDescription></div><LiveStamp status={realtime.status} eventAt={realtime.eventAt ?? logs.sampledAt} /></div></CardHeader><CardContent className="p-0">
      <Table aria-label="Eventos de logs" className="table-fixed font-mono text-xs"><TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-[16%] px-4">Fecha y hora</TableHead><TableHead className="w-[14%]">Fuente</TableHead><TableHead className="w-[8%]">Nivel</TableHead><TableHead className="w-[22%]">Evento</TableHead><TableHead className="w-[40%] pr-4">Datos</TableHead></TableRow></TableHeader><TableBody>{logs.entries.map((entry, index) => <LogRow key={`${entry.timestamp ?? "log"}-${index}`} entry={entry} />)}{logs.entries.length === 0 && <TableRow><TableCell colSpan={5} className="p-12 text-center font-sans text-sm text-muted-foreground">No hay eventos para estos filtros.</TableCell></TableRow>}</TableBody></Table>
    </CardContent></Card>
  </div>;
}

function LogRow({ entry }: { entry: SystemLogEntry }) { const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => !["timestamp", "level", "source", "message"].includes(key))); return <TableRow><TableCell className="whitespace-normal px-4 align-top text-muted-foreground"><time>{formatDate(entry.timestamp)}</time></TableCell><TableCell className="whitespace-normal align-top"><Badge variant="outline" className="max-w-full font-sans"><span className="truncate">{entry.source ?? "unknown"}</span></Badge></TableCell><TableCell className={`whitespace-normal align-top ${levelClass(entry.level)}`}>{entry.level ?? "info"}</TableCell><TableCell className="whitespace-normal break-words align-top font-medium text-foreground">{entry.message ?? "Evento"}</TableCell><TableCell className="whitespace-normal pr-4 align-top">{Object.keys(rest).length === 0 ? <span className="text-muted-foreground">—</span> : <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground">{JSON.stringify(rest as Record<string, Json | undefined>)}</pre>}</TableCell></TableRow>; }
function levelClass(level: string | undefined): string { return level === "error" ? "text-destructive" : level === "warn" ? "text-amber-300" : "text-primary"; }
function formatDate(value: string | undefined): string { if (value === undefined) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium" }).format(date); }
