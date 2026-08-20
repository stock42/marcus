import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { AgentApiTestCase } from "@/components/agent-api-test-case";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { requestMarcus } from "@/lib/marcus/server";
import { marcusApiUrl } from "@/lib/marcus/origin";
import type { AgentContract, AgentDefinition, Project } from "@/lib/marcus/types";

type Props = { params: Promise<{ projectId: string; agent: string }> };
export const metadata: Metadata = { title: "Test case del agente" };

export default async function AgentTestCasePage({ params }: Props) {
  const { projectId, agent: agentReference } = await params;
  const projectPath = encodeURIComponent(projectId);
  const agentPath = encodeURIComponent(agentReference);
  const [projectResult, agentResult, contractResult] = await Promise.all([
    requestMarcus<Project>(`/api/v1/projects/${projectPath}`),
    requestMarcus<AgentDefinition>(`/api/v1/projects/${projectPath}/agents/${agentPath}`),
    requestMarcus<AgentContract>(`/api/v1/projects/${projectPath}/agents/${agentPath}/contract`),
  ]);
  if (!agentResult.envelope.ok) return <ApiErrorPanel code={agentResult.envelope.error.code} message={agentResult.envelope.error.message} />;
  if (!contractResult.envelope.ok) return <ApiErrorPanel code={contractResult.envelope.error.code} message={contractResult.envelope.error.message} />;

  const project = projectResult.envelope.ok ? projectResult.envelope.data : undefined;
  const agent = agentResult.envelope.data;
  const contract = contractResult.envelope.data;
  const api = contract.entrypoints.api;
  const agentHref = `/projects/${projectPath}/agents/${agentPath}`;
  const endpoint = marcusApiUrl(`/api/v1/projects/${projectPath}/agents/${agentPath}/invoke`).href;

  if (api?.enabled !== true) {
    return <ApiErrorPanel code="AGENT_API_DISABLED" message="El acceso por API debe estar habilitado para ejecutar un Test case." />;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8">
      <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href="/projects">Proyectos</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link href={`/projects/${projectPath}`}>{project?.name ?? projectId}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link href={agentHref}>{agent.name}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Test case</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      <section className="page-heading">
        <div><p className="eyebrow flex items-center gap-2"><FlaskConical className="size-3.5" />VALIDACIÓN DE CONTRATO</p><h1>Test case vía API</h1><p>Editá un ejemplo válido, ejecutá la versión activa y seguí el Run en tiempo real.</p></div>
        <Button asChild variant="outline"><Link href={agentHref}><ArrowLeft />Volver al agente</Link></Button>
      </section>
      <AgentApiTestCase projectId={projectId} agent={agent.slug} endpoint={endpoint} authentication={api.authentication.type} inputSchema={contract.contract.inputSchema} outputSchema={contract.contract.outputSchema} />
    </div>
  );
}
