import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Bot, FileCode2, KeyRound, LayoutDashboard, Sparkles, Users } from "lucide-react";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { DeleteProjectButton } from "@/components/delete-project-button";
import { GenerateAgentDialog } from "@/components/generate-agent-dialog";
import { ProjectMembersPanel } from "@/components/project-members-panel";
import { ProjectDashboardLive } from "@/components/project-dashboard-live";
import { ProjectTokensPanel } from "@/components/project-tokens-panel";
import { UploadFileDialog } from "@/components/upload-file-dialog";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getMarcusSession, requestMarcus } from "@/lib/marcus/server";
import type { AgentContract, AgentDefinition, Project, ProjectAccessToken, ProjectDashboard, ProjectFile, ProjectMember } from "@/lib/marcus/types";

type Props = { params: Promise<{ projectId: string }> };
export const metadata: Metadata = { title: "Detalle de proyecto" };

export default async function ProjectDetailPage({ params }: Props) {
  const { projectId } = await params;
  const id = encodeURIComponent(projectId);
  const [projectResult, agentsResult, filesResult, membersResult, dashboardResult, tokensResult, session] = await Promise.all([
    requestMarcus<Project>(`/api/v1/projects/${id}`),
    requestMarcus<AgentDefinition[]>(`/api/v1/projects/${id}/agents`),
    requestMarcus<ProjectFile[]>(`/api/v1/projects/${id}/files?${new URLSearchParams({ path: "project:/" })}`),
    requestMarcus<ProjectMember[]>(`/api/v1/projects/${id}/members`),
    requestMarcus<ProjectDashboard>(`/api/v1/projects/${id}/dashboard`),
    requestMarcus<ProjectAccessToken[]>(`/api/v1/projects/${id}/tokens`),
    getMarcusSession(),
  ]);
  const project = projectResult.envelope.ok ? projectResult.envelope.data : undefined;
  const agents = agentsResult.envelope.ok ? agentsResult.envelope.data : [];
  const files = filesResult.envelope.ok ? filesResult.envelope.data : [];
  const members = membersResult.envelope.ok ? membersResult.envelope.data.filter((member) => !member.systemAdmin) : [];
  const dashboard = dashboardResult.envelope.ok ? dashboardResult.envelope.data : emptyDashboard();
  const tokens = tokensResult.envelope.ok ? tokensResult.envelope.data : [];
  const contracts = await Promise.all(agents.map(async (agent) => ({
    agent,
    result: agent.activeVersionId === undefined ? undefined : await requestMarcus<AgentContract>(`/api/v1/projects/${id}/agents/${encodeURIComponent(agent.slug)}/contract`),
  })));
  const apiAgents = contracts.filter(({ result }) => result?.envelope.ok === true && result.envelope.data.entrypoints.api?.enabled === true).map(({ agent }) => agent.slug);
  const canManage = session.principal?.roles.includes("system_admin") === true
    || members.some((member) => member.userId === session.principal?.id && member.role === "project_owner");

  if (project === undefined) return <ApiErrorPanel code={projectResult.envelope.ok ? "PROJECT_NOT_FOUND" : projectResult.envelope.error.code} message={projectResult.envelope.ok ? "El proyecto no existe." : projectResult.envelope.error.message} />;

  const partial = [agentsResult, filesResult, membersResult, dashboardResult, tokensResult].some((result) => !result.envelope.ok);
  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8">
      <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href="/projects">Proyectos</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{project.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      <section className="page-heading">
        <div><p className="eyebrow">{project.slug}</p><h1>{project.name}</h1><p className="font-mono text-xs">{project.projectId}</p></div>
        <div className="flex flex-wrap gap-2"><UploadFileDialog projectId={projectId} /><GenerateAgentDialog projectId={projectId} /><DeleteProjectButton project={project} /></div>
      </section>

      {partial && <ApiErrorPanel code="PROJECT_DETAIL_PARTIAL" message="Parte del detalle no pudo cargarse desde Marcus API." />}

      <Tabs defaultValue="dashboard" className="gap-6">
        <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto border-b border-border/70 pb-1">
          <TabsTrigger value="dashboard" className="px-4 py-2"><LayoutDashboard />Dashboard</TabsTrigger>
          <TabsTrigger value="agents" className="px-4 py-2"><Bot />Agentes <Badge variant="outline">{agents.length}</Badge></TabsTrigger>
          <TabsTrigger value="users" className="px-4 py-2"><Users />Usuarios <Badge variant="outline">{members.length}</Badge></TabsTrigger>
          <TabsTrigger value="tokens" className="px-4 py-2"><KeyRound />Tokens <Badge variant="outline">{tokens.filter((token) => token.status === "active").length}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <ProjectDashboardLive project={project} initial={dashboard} />
          <section className="space-y-4" aria-labelledby="files-title">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Project Home</p><h2 id="files-title" className="text-xl font-semibold">Archivos recientes</h2></div><div className="flex gap-2"><UploadFileDialog projectId={projectId} /><Button asChild variant="outline"><Link href={`/projects/${id}/files`}>Ver todos<ArrowRight /></Link></Button></div></div>
            <Card className="border-border/75 bg-card/55"><CardContent className="divide-y divide-border/60 p-0">{files.slice(0, 8).map((file) => (
              <Link key={file.fileId} href={isEditable(file) ? `/projects/${id}/editor?${new URLSearchParams({ path: `project:/${file.relativePath}` })}` : `/projects/${id}/files`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40"><FileCode2 className="size-4 text-primary" /><span className="min-w-0 flex-1 truncate font-mono text-xs">{file.relativePath}</span><Badge variant="outline">v{file.revision}</Badge><ArrowRight className="size-4 text-muted-foreground" /></Link>
            ))}{files.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">El Project Home está vacío.</p>}</CardContent></Card>
          </section>
        </TabsContent>

        <TabsContent value="agents">
          <section className="space-y-4" aria-labelledby="agents-title">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Runtime catalog</p><h2 id="agents-title" className="text-xl font-semibold">Agentes</h2></div><GenerateAgentDialog projectId={projectId} /></div>
            {agents.length === 0 ? (
              <Empty className="min-h-64 border border-border/80 bg-card/35"><EmptyHeader><EmptyMedia variant="icon"><Sparkles /></EmptyMedia><EmptyTitle>Todavía no hay agentes</EmptyTitle><EmptyDescription>Describí una capacidad en lenguaje natural y Marcus generará una fuente Markdown ejecutable.</EmptyDescription></EmptyHeader></Empty>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{agents.map((agent) => (
                <Card key={agent.agentId} className="border-border/75 bg-card/55">
                  <CardHeader><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bot /></div><CardTitle>{agent.name}</CardTitle><CardDescription className="font-mono text-xs">{agent.slug}</CardDescription><CardAction><Badge variant="outline">{agent.status}</Badge></CardAction></CardHeader>
                  <CardContent><p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{agent.description ?? "Sin descripción."}</p><div className="mt-3 flex items-center gap-2"><Badge variant={apiAgents.includes(agent.slug) ? "default" : "outline"}>API {apiAgents.includes(agent.slug) ? "activa" : "inactiva"}</Badge></div><p className="mt-3 font-mono text-[11px] text-muted-foreground">{agent.sourcePath ?? "Fuente no registrada"}</p></CardContent>
                  <CardFooter className="justify-end"><Button asChild variant="ghost" size="sm"><Link href={`/projects/${id}/agents/${encodeURIComponent(agent.slug)}`}>Ver agente<ArrowRight /></Link></Button></CardFooter>
                </Card>
              ))}</div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="users"><ProjectMembersPanel projectId={projectId} members={members} canManage={canManage} /></TabsContent>
        <TabsContent value="tokens"><ProjectTokensPanel projectId={projectId} tokens={tokens} apiAgents={apiAgents} canManage={canManage} /></TabsContent>
      </Tabs>
    </div>
  );
}

function emptyDashboard(): ProjectDashboard {
  const now = new Date();
  return { files: 0, agents: 0, activeAgents: 0, apiAgents: 0, runs: 0, consumption: Array.from({ length: 30 }, (_, index) => { const date = new Date(now); date.setUTCDate(date.getUTCDate() - (29 - index)); return { day: date.toISOString().slice(0, 10), runs: 0, completed: 0, failed: 0 }; }) };
}

function isEditable(file: ProjectFile): boolean {
  return file.kind === "file" && (file.mediaType?.startsWith("text/") === true || /\.(?:md|mdx|txt|json|ya?ml|toml|ts|tsx|js|jsx|css|html|xml|csv|sql|sh)$/iu.test(file.relativePath));
}
