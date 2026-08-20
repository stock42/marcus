import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateUploadOpen } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string }> };
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  const { projectId } = await context.params;
  const validation = validateUploadOpen(await request.json().catch(() => null));
  if (!validation.ok) return invalidRequest(validation.message);
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/uploads`, { body: validation.value });
}

function invalidRequest(message: string) {
  return Response.json({ ok: false, error: { code: "INPUT_INVALID", message, retryable: false } }, { status: 400 });
}
