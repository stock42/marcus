import { apiController } from "@/http/controller";

export default apiController({
  name: "secrets.list",
  method: "GET",
  path: "/api/v1/projects/:project/secrets",
  route: (request) => ({ operation: "secrets.list", payload: {}, projectId: request.params.project }),
});
