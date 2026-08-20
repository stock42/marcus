import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateProjectMemberCreate } from "@/lib/marcus/validation";

type Context = { params: Promise<{ projectId: string }> };
export const dynamic = "force-dynamic";

export function GET(request: Request, context: Context) {
  return context.params.then(({ projectId }) => proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/members`));
}

export async function POST(request: Request, context: Context) {
  const validation = validateProjectMemberCreate(await request.json().catch(() => null));
  if (!validation.ok) return invalidRequest(validation.message);
  const { projectId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/members/users`, { body: validation.value });
}

function invalidRequest(message: string) {
  return Response.json({ ok: false, error: { code: "INPUT_INVALID", message, retryable: false } }, { status: 400 });
}
