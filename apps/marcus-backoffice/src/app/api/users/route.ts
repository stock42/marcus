import { proxyMarcus } from "@/lib/marcus/proxy";
import { validateAdminUser } from "@/lib/marcus/validation";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return proxyMarcus(request, "/api/v1/users");
}

export async function POST(request: Request) {
  const validation = validateAdminUser(await request.json().catch(() => null));
  if (!validation.ok) return invalidRequest(validation.message);
  return proxyMarcus(request, "/api/v1/users", { body: validation.value });
}

function invalidRequest(message: string) {
  return Response.json({ ok: false, error: { code: "INPUT_INVALID", message, retryable: false } }, { status: 400 });
}
