import type { Metadata } from "next";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { RunsLive } from "@/components/runs-live";
import { requestMarcus } from "@/lib/marcus/server";
import type { AgentDefinition, Project, Run } from "@/lib/marcus/types";

export const metadata: Metadata = { title: "Runs" };

export default async function RunsPage() {
  const projectsResult = await requestMarcus<Project[]>("/api/v1/projects?status=active");
  const projects = projectsResult.envelope.ok ? projectsResult.envelope.data : [];
  const runResults = await Promise.all(projects.map(async (project) => {
    const [result, agentsResult] = await Promise.all([
      requestMarcus<Run[]>(`/api/v1/projects/${encodeURIComponent(project.projectId)}/runs?limit=100`),
      requestMarcus<AgentDefinition[]>(`/api/v1/projects/${encodeURIComponent(project.projectId)}/agents`),
    ]);
    return { project, result, agentsResult };
  }));
  if (!projectsResult.envelope.ok) return <ApiErrorPanel code={projectsResult.envelope.error.code} message={projectsResult.envelope.error.message} />;
  const snapshots = runResults.map(({ project, result, agentsResult }) => ({ project, runs: result.envelope.ok ? result.envelope.data : [], agents: agentsResult.envelope.ok ? agentsResult.envelope.data : [] }));
  return <><RunsLive initialProjects={projects} initialSnapshots={snapshots} />{runResults.some(({ result, agentsResult }) => !result.envelope.ok || !agentsResult.envelope.ok) && <ApiErrorPanel code="RUNS_PARTIAL" message="No se pudieron cargar los Runs o agentes de uno o más proyectos." />}</>;
}
