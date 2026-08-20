import Link from "next/link";
import type { Metadata } from "next";
import { Bot, Braces, CalendarClock, CheckCircle2, FileEdit, Fingerprint, GitBranch } from "lucide-react";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { AgentApiAccess } from "@/components/agent-api-access";
import { AgentCompiledArtifact } from "@/components/agent-compiled-artifact";
import { PendingAgentSource } from "@/components/pending-agent-source";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requestMarcus } from "@/lib/marcus/server";
import { marcusApiUrl } from "@/lib/marcus/origin";
import type { AgentContract, AgentDefinition, AgentVersion, Project } from "@/lib/marcus/types";

type Props = { params: Promise<{ projectId: string; agent: string }> };
export const metadata: Metadata = { title: "Agente" };

export default async function AgentPage({ params }: Props) {
  const { projectId, agent: agentReference } = await params;
  const projectPath = encodeURIComponent(projectId);
  const agentPath = encodeURIComponent(agentReference);
  const [projectResult, agentResult, versionsResult, contractResult] = await Promise.all([
    requestMarcus<Project>(`/api/v1/projects/${projectPath}`),
    requestMarcus<AgentDefinition>(`/api/v1/projects/${projectPath}/agents/${agentPath}`),
    requestMarcus<AgentVersion[]>(`/api/v1/projects/${projectPath}/agents/${agentPath}/versions`),
    requestMarcus<AgentContract>(`/api/v1/projects/${projectPath}/agents/${agentPath}/contract`),
  ]);
  if (!agentResult.envelope.ok) return <ApiErrorPanel code={agentResult.envelope.error.code} message={agentResult.envelope.error.message} />;
  const project = projectResult.envelope.ok ? projectResult.envelope.data : undefined;
  const agent = agentResult.envelope.data;
  const versions = versionsResult.envelope.ok ? versionsResult.envelope.data : [];
  const contract = contractResult.envelope.ok ? contractResult.envelope.data : undefined;
  const api = contract?.entrypoints.api;
  const endpoint = marcusApiUrl(`/api/v1/projects/${projectPath}/agents/${agentPath}/invoke`).href;
  const sourceHref = agent.sourcePath === undefined ? undefined : `/projects/${projectPath}/editor?${new URLSearchParams({ path: agent.sourcePath })}`;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-8">
      <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href="/projects">Proyectos</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link href={`/projects/${projectPath}`}>{project?.name ?? projectId}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{agent.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      <section className="page-heading"><div><p className="eyebrow">{agent.kind}</p><h1>{agent.name}</h1><p>{agent.description ?? "Agente Marcus sin descripción."}</p></div>{sourceHref !== undefined && <Button asChild><Link href={sourceHref}><FileEdit />Editar fuente</Link></Button>}</section>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Bot} label="Estado" value={agent.status} />
        <Metric icon={GitBranch} label="Versiones" value={versions.length.toString()} />
        <Metric icon={CheckCircle2} label="Fuente" value={agent.sourceState ?? "sin fuente"} />
        <Metric icon={CalendarClock} label="Actualizado" value={formatDate(agent.updatedAt)} />
      </section>
      {agent.sourceState === "dirty" && sourceHref !== undefined && <PendingAgentSource projectId={projectId} agent={agent.slug} sourceHref={sourceHref} />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="border-border/75 bg-card/55"><CardHeader><CardTitle>Historial de versiones</CardTitle><CardDescription>Artefactos inmutables registrados por marcusd.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Versión</TableHead><TableHead>Origen</TableHead><TableHead>Estado</TableHead><TableHead>Creada</TableHead><TableHead className="text-right">Compilado</TableHead></TableRow></TableHeader><TableBody>{versions.map((version) => <TableRow key={version.agentVersionId}><TableCell className="font-mono text-xs">{version.agentVersionId}</TableCell><TableCell><Badge variant="outline">{version.sourceKind}</Badge></TableCell><TableCell>{version.status}</TableCell><TableCell><time dateTime={version.createdAt} data-agent-version-created-at>{formatDate(version.createdAt)}</time></TableCell><TableCell className="text-right">{version.sourceKind === "markdown" ? <AgentCompiledArtifact projectId={projectId} agent={agent.slug} versionId={version.agentVersionId} /> : <span className="text-xs text-muted-foreground">SDK</span>}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
        <div className="space-y-5"><AgentApiAccess projectId={projectId} agent={agent.slug} endpoint={endpoint} enabled={api?.enabled === true} authentication={api?.authentication.type} supported={agent.sourcePath?.endsWith(".agent.md") === true} inputSchema={contract?.contract.inputSchema ?? { type: "object", properties: {} }} /><Card className="border-border/75 bg-card/55"><CardHeader><CardTitle className="flex items-center gap-2"><Braces className="size-4 text-primary" />Fuente</CardTitle><CardDescription>Definición autoritativa del agente.</CardDescription></CardHeader><CardContent className="space-y-4"><div><p className="text-xs text-muted-foreground">Path lógico</p><p className="mt-1 break-all font-mono text-xs">{agent.sourcePath ?? "No registrado"}</p></div><div><p className="text-xs text-muted-foreground">ID</p><p className="mt-1 break-all font-mono text-xs"><Fingerprint className="mr-1 inline size-3" />{agent.agentId}</p></div>{sourceHref !== undefined && <Button asChild className="w-full"><Link href={sourceHref}><FileEdit />Abrir editor</Link></Button>}</CardContent></Card></div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) { return <Card size="sm" className="border-border/70 bg-card/45"><CardHeader><CardDescription>{label}</CardDescription><Icon className="size-4 text-primary" /></CardHeader><CardContent><strong className="capitalize">{value}</strong></CardContent></Card>; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(date); }
