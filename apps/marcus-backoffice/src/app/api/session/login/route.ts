import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateLogin } from "@/lib/marcus/validation";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const validation = validateLogin(payload);
  if (!validation.ok) return invalidRequest(validation.message);
  return proxyMarcus(request, "/api/v1/auth/login", { body: validation.value });
}

function invalidRequest(message: string) {
  return Response.json({ ok: false, error: { code: "INPUT_INVALID", message, retryable: false } }, { status: 400 });
}
