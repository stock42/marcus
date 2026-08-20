import type { Metadata } from "next";
import { Filter, Search } from "lucide-react";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { SystemLogsLive } from "@/components/system-logs-live";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { requestMarcus } from "@/lib/marcus/server";
import type { SystemLogs } from "@/lib/marcus/types";

type Props = { searchParams: Promise<{ q?: string; source?: string; level?: string }> };
export const metadata: Metadata = { title: "Logs" };

export default async function LogsPage({ searchParams }: Props) {
  const filters = await searchParams;
  const query = new URLSearchParams({ limit: "300", ...(filters.q === undefined || filters.q === "" ? {} : { q: filters.q }), ...(filters.source === undefined || filters.source === "all" ? {} : { source: filters.source }), ...(filters.level === undefined || filters.level === "all" ? {} : { level: filters.level }) });
  const result = await requestMarcus<SystemLogs>(`/api/v1/system/logs?${query}`);
  if (!result.envelope.ok) return <ApiErrorPanel code={result.envelope.error.code} message={result.envelope.error.message} />;
  const logs = result.envelope.data;
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8">
      <section className="page-heading"><div><p className="eyebrow">Unified observability</p><h1>Logs</h1><p>Stream redacted compartido por marcusd, Marcus API y Backoffice; actualizado por eventos.</p></div></section>
      <Card className="border-border/75 bg-card/55"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Filter className="size-4 text-primary" />Filtros</CardTitle><CardDescription>Buscá eventos, IDs, operaciones, errores o fuentes.</CardDescription></CardHeader><CardContent><form className="grid gap-4 md:grid-cols-[minmax(260px,1fr)_220px_180px_auto]" action="/logs"><div className="space-y-2"><Label htmlFor="logs-query">Texto</Label><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="logs-query" name="q" defaultValue={filters.q} placeholder="runId, operación, error…" className="pl-9" /></div></div><div className="space-y-2"><Label htmlFor="logs-source">Fuente</Label><NativeSelect id="logs-source" name="source" defaultValue={filters.source ?? "all"}><NativeSelectOption value="all">Todas</NativeSelectOption><NativeSelectOption value="marcusd">marcusd</NativeSelectOption><NativeSelectOption value="marcus-api">marcus-api</NativeSelectOption><NativeSelectOption value="marcus-backoffice">marcus-backoffice</NativeSelectOption></NativeSelect></div><div className="space-y-2"><Label htmlFor="logs-level">Nivel</Label><NativeSelect id="logs-level" name="level" defaultValue={filters.level ?? "all"}><NativeSelectOption value="all">Todos</NativeSelectOption><NativeSelectOption value="error">Error</NativeSelectOption><NativeSelectOption value="warn">Warn</NativeSelectOption><NativeSelectOption value="info">Info</NativeSelectOption></NativeSelect></div><Button type="submit" className="self-end"><Search />Buscar</Button></form></CardContent></Card>
      <SystemLogsLive initial={logs} filters={filters} />
    </div>
  );
}
