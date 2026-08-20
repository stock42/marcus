import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string }> };
export const dynamic = "force-dynamic";

export function GET(request: Request, context: Context) {
  return context.params.then(({ projectId }) => {
    const requested = Number(new URL(request.url).searchParams.get("limit") ?? "100");
    const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(requested, 100)) : 100;
    return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/runs?${new URLSearchParams({ limit: String(limit) })}`);
  });
}
