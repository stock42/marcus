import { proxyMarcus } from "@/lib/marcus/proxy";

export function POST(request: Request) {
  return proxyMarcus(request, "/api/v1/auth/logout", { body: {} });
}
