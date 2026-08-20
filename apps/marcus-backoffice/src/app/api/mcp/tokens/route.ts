import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateProjectToken } from "@/lib/marcus/validation";

export async function GET(request: Request): Promise<Response> {
  return proxyMarcus(request, "/api/v1/mcp/tokens");
}

export async function POST(request: Request): Promise<Response> {
  const validation = validateProjectToken(await request.json().catch(() => null));
  if (!validation.ok) return Response.json({ ok: false, error: { code: "INPUT_INVALID", message: validation.message, retryable: false } }, { status: 400 });
  return proxyMarcus(request, "/api/v1/mcp/tokens", { body: validation.value });
}
