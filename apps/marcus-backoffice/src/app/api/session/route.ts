import { proxyMarcus } from "@/lib/marcus/proxy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return proxyMarcus(request, "/api/v1/auth/session");
}
