import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateLogicalPath } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string }> };
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const { projectId } = await context.params;
  const validation = validateLogicalPath(new URL(request.url).searchParams.get("path"));
  if (!validation.ok) {
    return Response.json({ ok: false, error: { code: "INPUT_INVALID", message: validation.message, retryable: false } }, { status: 400 });
  }
  const query = new URLSearchParams({ path: validation.value });
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/files/stat?${query}`);
}
