import type { Metadata } from "next";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { RuntimeLive } from "@/components/runtime-live";
import { requestMarcus } from "@/lib/marcus/server";
import type { AgentSchedule, Approval, Project, RuntimeProcess } from "@/lib/marcus/types";

export const metadata: Metadata = { title: "Runtime" };

export default async function RuntimePage() {
  const projectsResult = await requestMarcus<Project[]>("/api/v1/projects?status=active");
  if (!projectsResult.envelope.ok) return <ApiErrorPanel code={projectsResult.envelope.error.code} message={projectsResult.envelope.error.message} />;
  const projects = projectsResult.envelope.data;
  const snapshots = await Promise.all(projects.map(async (project) => {
    const [processes, approvals, schedules] = await Promise.all([
      requestMarcus<RuntimeProcess[]>(`/api/v1/projects/${encodeURIComponent(project.projectId)}/processes?includeTerminal=false`),
      requestMarcus<Approval[]>(`/api/v1/projects/${encodeURIComponent(project.projectId)}/approvals?status=pending&limit=100`),
      requestMarcus<AgentSchedule[]>(`/api/v1/projects/${encodeURIComponent(project.projectId)}/schedules`),
    ]);
    return { project, processes, approvals, schedules };
  }));
  const partial = snapshots.some(({ processes, approvals, schedules }) => !processes.envelope.ok || !approvals.envelope.ok || !schedules.envelope.ok);
  const initialSnapshots = snapshots.map(({ project, processes, approvals, schedules }) => ({ project, processes: processes.envelope.ok ? processes.envelope.data : [], approvals: approvals.envelope.ok ? approvals.envelope.data : [], schedules: schedules.envelope.ok ? schedules.envelope.data : [] }));
  return <><RuntimeLive initialProjects={projects} initialSnapshots={initialSnapshots} />{partial && <ApiErrorPanel code="RUNTIME_PARTIAL" message="Parte del estado Runtime no pudo cargarse." />}</>;
}
