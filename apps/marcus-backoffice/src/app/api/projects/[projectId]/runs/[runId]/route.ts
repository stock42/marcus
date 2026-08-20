import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string; runId: string }> };
export const dynamic = "force-dynamic";

export function GET(request: Request, context: Context) {
  return context.params.then(({ projectId, runId }) => proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`));
}
