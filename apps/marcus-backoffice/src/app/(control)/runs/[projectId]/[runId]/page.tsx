import type { Metadata } from "next";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { RunDetailLive } from "@/components/run-detail-live";
import { requestMarcus } from "@/lib/marcus/server";
import type { AgentDefinition, Project, Run } from "@/lib/marcus/types";

type Props = { params: Promise<{ projectId: string; runId: string }> };
export const metadata: Metadata = { title: "Detalle de Run" };

export default async function RunDetailPage({ params }: Props) {
  const { projectId, runId } = await params;
  const encodedProject = encodeURIComponent(projectId);
  const encodedRun = encodeURIComponent(runId);
  const [runResult, projectResult] = await Promise.all([
    requestMarcus<Run>(`/api/v1/projects/${encodedProject}/runs/${encodedRun}`),
    requestMarcus<Project>(`/api/v1/projects/${encodedProject}`),
  ]);
  if (!runResult.envelope.ok) return <ApiErrorPanel code={runResult.envelope.error.code} message={runResult.envelope.error.message} />;
  const run = runResult.envelope.data;
  const agentResult = await requestMarcus<AgentDefinition>(`/api/v1/projects/${encodedProject}/agents/${encodeURIComponent(run.agentId)}`);
  const project = projectResult.envelope.ok ? projectResult.envelope.data : undefined;
  const agent = agentResult.envelope.ok ? agentResult.envelope.data : undefined;
  return <RunDetailLive initial={run} project={project} agent={agent} />;
}
