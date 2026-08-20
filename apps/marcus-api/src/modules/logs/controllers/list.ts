import { apiController } from "@/http/controller";

export default apiController({
  name: "logs.list",
  method: "GET",
  path: "/api/v1/projects/:project/logs",
  route: (request) => ({ operation: "logs.list", payload: request.query, projectId: request.params.project }),
});
