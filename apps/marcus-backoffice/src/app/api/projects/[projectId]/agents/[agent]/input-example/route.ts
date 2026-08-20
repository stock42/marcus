import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string; agent: string }> };
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  const { projectId, agent } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/input-example`, {
    body: {},
    timeoutMs: 60_000,
  });
}
