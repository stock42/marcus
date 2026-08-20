import { proxyMarcus } from "@/lib/marcus/proxy";

type Context = { params: Promise<{ tokenId: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { tokenId } = await context.params;
  return proxyMarcus(request, `/api/v1/mcp/tokens/${encodeURIComponent(tokenId)}`);
}
