import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ projectId: string; tokenId: string }> };
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: Context) {
  const { projectId, tokenId } = await context.params;
  return proxyMarcus(request, `/api/v1/projects/${encodeURIComponent(projectId)}/tokens/${encodeURIComponent(tokenId)}`);
}
