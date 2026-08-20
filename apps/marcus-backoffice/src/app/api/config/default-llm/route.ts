import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateDefaultLlm } from "@/lib/marcus/validation";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return proxyMarcus(request, "/api/v1/config/default-llm");
}

export async function PUT(request: Request) {
  const validation = validateDefaultLlm(await request.json().catch(() => null));
  if (!validation.ok) return Response.json({ ok: false, error: { code: "INPUT_INVALID", message: validation.message, retryable: false } }, { status: 400 });
  return proxyMarcus(request, "/api/v1/config/default-llm", { body: validation.value, timeoutMs: 45_000 });
}
