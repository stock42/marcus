import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateProject } from "@/lib/marcus/validation";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return proxyMarcus(request, "/api/v1/projects");
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const validation = validateProject(payload);
  if (!validation.ok) return invalidRequest(validation.message);
  return proxyMarcus(request, "/api/v1/projects", { body: validation.value });
}

function invalidRequest(message: string) {
  return Response.json({ ok: false, error: { code: "INPUT_INVALID", message, retryable: false } }, { status: 400 });
}
