import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateAssistant } from "@/lib/marcus/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const validation = validateAssistant(await request.json().catch(() => null));
  if (!validation.ok) return Response.json({ ok: false, error: { code: "INPUT_INVALID", message: validation.message, retryable: false } }, { status: 400 });
  return proxyMarcus(request, "/api/v1/assistant/chat", { body: validation.value, timeoutMs: 180_000 });
}
