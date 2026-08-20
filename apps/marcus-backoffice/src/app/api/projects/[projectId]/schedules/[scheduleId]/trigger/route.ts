import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string; scheduleId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const { projectId, scheduleId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/schedules/${encodeURIComponent(scheduleId)}/trigger`, {
    body: await request.json() as Record<string, unknown>,
  });
}
