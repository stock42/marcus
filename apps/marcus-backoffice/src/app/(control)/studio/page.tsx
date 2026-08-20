import type { Metadata } from "next";
import { ApiErrorPanel } from "@/components/api-error-panel";
import { AgentStudio } from "@/components/agent-studio";
import { requestMarcus } from "@/lib/marcus/server";
import type { Project } from "@/lib/marcus/types";

export const metadata: Metadata = { title: "Agent Studio" };

export default async function StudioPage() {
  const projectsResult = await requestMarcus<Project[]>("/api/v1/projects?status=active");
  if (!projectsResult.envelope.ok) return <ApiErrorPanel code={projectsResult.envelope.error.code} message={projectsResult.envelope.error.message} />;
  return <div className="mx-auto w-full max-w-[1500px] space-y-8"><section className="page-heading"><div><p className="eyebrow">Agent architecture</p><h1>Agent Studio</h1><p>Pasá de una necesidad de negocio a un plan implementable, revisable y listo para Marcus.</p></div></section><AgentStudio projects={projectsResult.envelope.data} /></div>;
}
