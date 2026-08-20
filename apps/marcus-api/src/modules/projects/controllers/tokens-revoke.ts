import { apiController } from "@/http/controller";

export default apiController({
  name: "projectTokens.revoke",
  method: "DELETE",
  path: "/api/v1/projects/:project/tokens/:token",
  route: (request) => ({ operation: "projectTokens.revoke", payload: { tokenId: request.params.token }, projectId: request.params.project }),
});
