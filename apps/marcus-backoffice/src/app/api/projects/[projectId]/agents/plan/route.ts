import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateAgentPlan } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const validation = validateAgentPlan(await request.json().catch(() => null));
  if (!validation.ok) return Response.json({ ok: false, error: { code: "INPUT_INVALID", message: validation.message, retryable: false } }, { status: 400 });
  const { projectId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/agents/plan`, {
    body: validation.value,
    timeoutMs: 95_000,
  });
}
