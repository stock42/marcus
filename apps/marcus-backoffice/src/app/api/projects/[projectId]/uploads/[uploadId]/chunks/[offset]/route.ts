import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateUploadChunk } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string; uploadId: string; offset: string }> };
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: Context) {
  const { projectId, uploadId, offset } = await context.params;
  if (!/^\d+$/u.test(offset)) return invalidRequest("El offset no es válido.");
  const validation = validateUploadChunk(await request.json().catch(() => null));
  if (!validation.ok) return invalidRequest(validation.message);
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(uploadId)}/chunks/${offset}`, { body: validation.value });
}

function invalidRequest(message: string) {
  return Response.json({ ok: false, error: { code: "INPUT_INVALID", message, retryable: false } }, { status: 400 });
}
