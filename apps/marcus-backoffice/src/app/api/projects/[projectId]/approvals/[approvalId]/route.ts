import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string; approvalId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId, approvalId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/approvals/${encodeURIComponent(approvalId)}/decision`, {
    body: await request.json() as Record<string, unknown>,
  });
}
