import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, FolderKanban, FolderOpen, Layers3, RadioTower } from "lucide-react";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { requestMarcus } from "@/lib/marcus/server";
import type { Project } from "@/lib/marcus/types";

export const metadata: Metadata = { title: "Proyectos" };

export default async function ProjectsPage() {
  const result = await requestMarcus<Project[]>("/api/v1/projects?status=active");
  const projects = result.envelope.ok ? result.envelope.data : [];
  const active = projects.filter((project) => project.status === "active").length;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Project Homes</p>
          <h1>Proyectos</h1>
          <p>Workspaces registrados, persistidos y gobernados por marcusd.</p>
        </div>
        <CreateProjectDialog />
      </section>

      {!result.envelope.ok && <ApiErrorPanel code={result.envelope.error.code} message={result.envelope.error.message} />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Resumen de proyectos">
        <MetricCard icon={FolderKanban} label="Total" value={projects.length} detail="Project Homes registrados" />
        <MetricCard icon={RadioTower} label="Activos" value={active} detail="Disponibles para ejecución" />
        <MetricCard icon={Layers3} label="Arquitectura" value="MNP/1" detail="Autoridad central en marcusd" />
      </section>

      <section aria-labelledby="project-list-title" className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Workspace registry</p>
            <h2 id="project-list-title" className="text-xl font-semibold tracking-tight">Project Homes</h2>
          </div>
          <Badge variant="outline">{projects.length} {projects.length === 1 ? "proyecto" : "proyectos"}</Badge>
        </div>
        <Separator />
        {projects.length === 0 && result.envelope.ok ? (
          <Empty className="min-h-72 border border-border/80 bg-card/35">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FolderOpen /></EmptyMedia>
              <EmptyTitle>Todavía no hay proyectos</EmptyTitle>
              <EmptyDescription>Creá el primer Project Home para administrar archivos y agentes.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent><CreateProjectDialog /></EmptyContent>
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {projects.map((project) => (
              <Card key={project.projectId} className="project-card border border-transparent bg-card/70 transition hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-xl hover:shadow-primary/5">
                <CardHeader>
                  <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/8 text-primary"><FolderKanban /></div>
                  <CardTitle className="text-lg">{project.name}</CardTitle>
                  <CardDescription className="font-mono text-xs">{project.slug}</CardDescription>
                  <CardAction>
                    <Badge variant={project.status === "active" ? "default" : "secondary"} className={project.status === "active" ? "bg-primary/15 text-primary" : ""}>
                      {project.status === "active" ? "Activo" : "Archivado"}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <p className="truncate font-mono text-[11px] text-muted-foreground" title={project.projectId}>{project.projectId}</p>
                </CardContent>
                <CardFooter className="justify-between bg-background/25">
                  <span className="text-xs text-muted-foreground">Revisiones y paths lógicos</span>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/projects/${encodeURIComponent(project.projectId)}`}>Abrir proyecto<ArrowUpRight /></Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof FolderKanban; label: string; value: string | number; detail: string }) {
  return (
    <Card size="sm" className="border border-border/70 bg-card/45">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction><Icon className="size-4 text-primary" /></CardAction>
      </CardHeader>
      <CardContent>
        <strong className="text-2xl font-semibold tracking-tight">{value}</strong>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
