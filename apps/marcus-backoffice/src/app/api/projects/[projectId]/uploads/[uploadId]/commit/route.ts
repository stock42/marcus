import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string; uploadId: string }> };
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  const { projectId, uploadId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(uploadId)}/commit`, { body: {} });
}
