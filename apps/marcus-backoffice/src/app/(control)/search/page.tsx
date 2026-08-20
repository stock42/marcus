import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Bot, FileCode2, FolderKanban, RadioTower, Search, SearchX, ScrollText } from "lucide-react";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { requestMarcus } from "@/lib/marcus/server";
import type { SearchResult, SystemSearch } from "@/lib/marcus/types";

type Props = { searchParams: Promise<{ q?: string }> };
export const metadata: Metadata = { title: "Buscar" };

export default async function SearchPage({ searchParams }: Props) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const result = query.length >= 2 ? await requestMarcus<SystemSearch>(`/api/v1/system/search?${new URLSearchParams({ q: query, limit: "100" })}`) : undefined;
  const results = result?.envelope.ok ? result.envelope.data.results : [];
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-8">
      <section className="page-heading"><div><p className="eyebrow">Global index</p><h1>Buscar</h1><p>Encontrá Projects, agentes, Runs, código y documentación desde una sola entrada.</p></div></section>
      <form action="/search" className="relative"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input name="q" defaultValue={q} minLength={2} maxLength={200} autoFocus placeholder="Agente, path, Run ID, error, concepto…" className="h-14 pl-12 pr-28 text-base" /><Button type="submit" className="absolute right-2 top-2 h-10">Buscar</Button></form>
      {result !== undefined && !result.envelope.ok && <ApiErrorPanel code={result.envelope.error.code} message={result.envelope.error.message} />}
      {query.length < 2 ? <EmptyState icon={Search} title="Escribí al menos dos caracteres" description="La búsqueda consulta estado real y documentación oficial sin indexar secretos." /> : results.length === 0 && result?.envelope.ok ? <EmptyState icon={SearchX} title="Sin coincidencias" description={`No encontramos resultados para “${query}”.`} /> : <section className="space-y-3" aria-label="Resultados"><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{results.length} resultados para <strong className="text-foreground">“{query}”</strong></p><Badge variant="outline">estado actual</Badge></div>{results.map((entry, index) => <ResultRow key={`${entry.kind}-${entry.projectId ?? "global"}-${entry.title}-${index}`} entry={entry} />)}</section>}
    </div>
  );
}

function ResultRow({ entry }: { entry: SearchResult }) {
  const Icon = entry.kind === "project" ? FolderKanban : entry.kind === "agent" ? Bot : entry.kind === "run" ? RadioTower : entry.kind === "file" ? FileCode2 : ScrollText;
  const href = resultHref(entry);
  const content = <Card className="group border-border/70 bg-card/45 transition hover:border-primary/30 hover:bg-card/70"><CardContent className="flex items-start gap-4 p-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/8 text-primary"><Icon className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="break-all text-sm">{entry.title}</strong><Badge variant="outline">{label(entry.kind)}</Badge>{entry.line !== undefined && <span className="font-mono text-[11px] text-muted-foreground">línea {entry.line}</span>}</div><p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{entry.detail}</p></div>{href !== undefined && <ArrowRight className="mt-2 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />}</CardContent></Card>;
  return href === undefined ? content : <Link href={href}>{content}</Link>;
}

function resultHref(entry: SearchResult): string | undefined {
  if (entry.kind === "project" && entry.projectId !== undefined) return `/projects/${encodeURIComponent(entry.projectId)}`;
  if (entry.kind === "agent" && entry.projectId !== undefined && entry.agent !== undefined) return `/projects/${encodeURIComponent(entry.projectId)}/agents/${encodeURIComponent(entry.agent)}`;
  if (entry.kind === "run" && entry.projectId !== undefined && entry.runId !== undefined) return `/runs/${encodeURIComponent(entry.projectId)}/${encodeURIComponent(entry.runId)}`;
  if (entry.kind === "file" && entry.projectId !== undefined && entry.path !== undefined) return `/projects/${encodeURIComponent(entry.projectId)}/editor?${new URLSearchParams({ path: entry.path })}`;
  return undefined;
}

function label(kind: SearchResult["kind"]): string { return kind === "project" ? "Project" : kind === "agent" ? "Agente" : kind === "run" ? "Run" : kind === "file" ? "Archivo" : "Documentación"; }
function EmptyState({ icon: Icon, title, description }: { icon: typeof Search; title: string; description: string }) { return <Empty className="min-h-72 border border-border/75 bg-card/35"><EmptyHeader><EmptyMedia variant="icon"><Icon /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>; }
