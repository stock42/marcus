import { proxyMarcus } from "@/lib/marcus/proxy";
import { validatePasswordChange } from "@/lib/marcus/validation";

export async function PATCH(request: Request) {
  const validation = validatePasswordChange(await request.json().catch(() => null));
  if (!validation.ok) {
    return Response.json({ ok: false, error: { code: "INPUT_INVALID", message: validation.message, retryable: false } }, { status: 400 });
  }
  return proxyMarcus(request, "/api/v1/users/me/password", { body: validation.value });
}
