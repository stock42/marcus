import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateAgentPrompt } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string }> };
export const dynamic = "force-dynamic";

export function GET(request: Request, context: Context) {
  return context.params.then(({ projectId }) => proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/agents`));
}

export async function POST(request: Request, context: Context) {
  const { projectId } = await context.params;
  const validation = validateAgentPrompt(await request.json().catch(() => null));
  if (!validation.ok) return invalidRequest(validation.message);
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/agents/generate`, { body: validation.value, timeoutMs: 120_000 });
}

function invalidRequest(message: string) {
  return Response.json({ ok: false, error: { code: "INPUT_INVALID", message, retryable: false } }, { status: 400 });
}
