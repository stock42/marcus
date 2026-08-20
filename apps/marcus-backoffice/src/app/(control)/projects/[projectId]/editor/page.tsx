import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { requestMarcus } from "@/lib/marcus/server";
import type { AgentDefinition, ProjectFile, ProjectFileContent } from "@/lib/marcus/types";

type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<{ path?: string }> };
export const metadata: Metadata = { title: "Editor" };

export default async function EditorPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const path = (await searchParams).path;
  if (path === undefined || !path.startsWith("project:/")) return <ApiErrorPanel code="PATH_INVALID" message="Elegí un archivo válido desde el detalle del proyecto." />;
  const projectPath = encodeURIComponent(projectId);
  const query = new URLSearchParams({ path });
  const [contentResult, statResult, agentsResult] = await Promise.all([
    requestMarcus<ProjectFileContent>(`/api/v1/projects/${projectPath}/files/content?${query}`),
    requestMarcus<ProjectFile>(`/api/v1/projects/${projectPath}/files/stat?${query}`),
    requestMarcus<AgentDefinition[]>(`/api/v1/projects/${projectPath}/agents`),
  ]);
  if (!contentResult.envelope.ok) return <ApiErrorPanel code={contentResult.envelope.error.code} message={contentResult.envelope.error.message} />;
  if (!statResult.envelope.ok) return <ApiErrorPanel code={statResult.envelope.error.code} message={statResult.envelope.error.message} />;
  const relativePath = path.replace(/^project:\/+/, "");
  const revision = statResult.envelope.data.revision;
  const content = Buffer.from(contentResult.envelope.data.data, "base64").toString("utf8");
  const sourceAgent = agentsResult.envelope.ok ? agentsResult.envelope.data.find((agent) => agent.sourcePath === path) : undefined;
  const backHref = sourceAgent === undefined
    ? `/projects/${projectPath}/files`
    : `/projects/${projectPath}/agents/${encodeURIComponent(sourceAgent.slug)}`;
  const backLabel = sourceAgent === undefined ? "Volver a archivos" : "Volver al agente";
  return <div className="mx-auto w-full max-w-[1500px] space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href="/projects">Proyectos</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link href={`/projects/${projectPath}`}>Proyecto</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{relativePath}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb><Button asChild variant="outline" size="sm"><Link href={backHref}><ArrowLeft />{backLabel}</Link></Button></div><MarkdownEditor projectId={projectId} path={path} initialContent={content} revision={revision} /></div>;
}
