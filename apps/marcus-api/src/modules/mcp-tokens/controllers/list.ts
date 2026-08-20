import { apiController } from "@/http/controller";

export default apiController({
  name: "mcpTokens.list",
  method: "GET",
  path: "/api/v1/mcp/tokens",
  route: { operation: "mcpTokens.list", payload: {} },
});
