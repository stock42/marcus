import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string }> };
export const dynamic = "force-dynamic";

export function GET(request: Request, context: Context) {
  return context.params.then(({ projectId }) => proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/dashboard`));
}
