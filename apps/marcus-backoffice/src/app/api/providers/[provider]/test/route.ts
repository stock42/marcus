import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ provider: string }> };
export const dynamic = "force-dynamic";

export function POST(request: Request, context: Context) {
  return context.params.then(({ provider }) => proxyMarcus(request, `/api/v1/providers/${encodeURIComponent(provider)}/test`, { body: {}, timeoutMs: 45_000 }));
}
