import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string; agent: string; versionId: string }> };
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const { projectId, agent, versionId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/versions/${encodeURIComponent(versionId)}/compiled`, { timeoutMs: 60_000 });
}
