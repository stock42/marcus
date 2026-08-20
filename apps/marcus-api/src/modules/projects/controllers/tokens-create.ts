import { apiController } from "@/http/controller";

export default apiController({
  name: "projectTokens.create",
  method: "POST",
  path: "/api/v1/projects/:project/tokens",
  route: (request) => ({ operation: "projectTokens.create", payload: request.body, projectId: request.params.project, status: 201 }),
});
