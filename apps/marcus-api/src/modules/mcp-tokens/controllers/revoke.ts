import { apiController } from "@/http/controller";

export default apiController({
  name: "mcpTokens.revoke",
  method: "DELETE",
  path: "/api/v1/mcp/tokens/:token",
  route: (request) => ({ operation: "mcpTokens.revoke", payload: { tokenId: request.params.token } }),
});
