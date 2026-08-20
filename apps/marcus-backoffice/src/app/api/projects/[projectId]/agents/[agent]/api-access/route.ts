import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateAgentApiAccess } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string; agent: string }> };
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: Context) {
  const validation = validateAgentApiAccess(await request.json().catch(() => null));
  if (!validation.ok) return Response.json({ ok: false, error: { code: "INPUT_INVALID", message: validation.message, retryable: false } }, { status: 400 });
  const { projectId, agent } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent)}/api-access`, { body: validation.value, timeoutMs: 60_000 });
}
