import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateProjectMemberUpdate } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string; userId: string }> };
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: Context) {
  const validation = validateProjectMemberUpdate(await request.json().catch(() => null));
  if (!validation.ok) return invalidRequest(validation.message);
  const { projectId, userId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { body: validation.value });
}

export async function DELETE(request: Request, context: Context) {
  const { projectId, userId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`);
}

function invalidRequest(message: string) {
  return Response.json({ ok: false, error: { code: "INPUT_INVALID", message, retryable: false } }, { status: 400 });
}
