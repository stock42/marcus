import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateFile, validateLogicalPath } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const { projectId } = await context.params;
  const validation = validateLogicalPath(new URL(request.url).searchParams.get("path"));
  if (!validation.ok) return invalidRequest(validation.message);
  const query = new URLSearchParams({ path: validation.value });
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/files?${query}`);
}

export async function PUT(request: Request, context: Context) {
  const { projectId } = await context.params;
  const payload = await request.json().catch(() => null);
  const validation = validateFile(payload);
  if (!validation.ok) return invalidRequest(validation.message);
  const query = new URLSearchParams({ path: validation.value.path });
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/files/content?${query}`, {
    body: { content: validation.value.content, ...(validation.value.expectedRevision === undefined ? {} : { expectedRevision: validation.value.expectedRevision }) },
  });
}

function invalidRequest(message: string) {
  return Response.json({ ok: false, error: { code: "INPUT_INVALID", message, retryable: false } }, { status: 400 });
}
