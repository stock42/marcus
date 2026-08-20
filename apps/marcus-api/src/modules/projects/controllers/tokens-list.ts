import { apiController } from "@/http/controller";

export default apiController({
  name: "projectTokens.list",
  method: "GET",
  path: "/api/v1/projects/:project/tokens",
  route: (request) => ({ operation: "projectTokens.list", payload: {}, projectId: request.params.project }),
});
