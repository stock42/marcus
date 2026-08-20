import { apiController } from "@/http/controller";

export default apiController({
  name: "mcpTokens.create",
  method: "POST",
  path: "/api/v1/mcp/tokens",
  route: (request) => ({ operation: "mcpTokens.create", payload: request.body, status: 201 }),
});
