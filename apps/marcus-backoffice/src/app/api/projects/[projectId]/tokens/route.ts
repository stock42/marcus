import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateProjectToken } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string }> };
export const dynamic = "force-dynamic";

export function GET(request: Request, context: Context) {
  return context.params.then(({ projectId }) => proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/tokens`));
}

export async function POST(request: Request, context: Context) {
  const validation = validateProjectToken(await request.json().catch(() => null));
  if (!validation.ok) return Response.json({ ok: false, error: { code: "INPUT_INVALID", message: validation.message, retryable: false } }, { status: 400 });
  const { projectId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/tokens`, { body: validation.value });
}
