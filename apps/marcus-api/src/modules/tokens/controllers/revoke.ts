import { apiController } from "@/http/controller";

export default apiController({
  name: "tokens.revoke",
  method: "DELETE",
  path: "/api/v1/tokens/:token",
  route: (request) => ({ operation: "tokens.revoke", payload: { tokenId: request.params.token } }),
});
