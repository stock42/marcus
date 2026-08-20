import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string; mpid: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId, mpid } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/processes/${encodeURIComponent(mpid)}/kill`, { body: {} });
}
