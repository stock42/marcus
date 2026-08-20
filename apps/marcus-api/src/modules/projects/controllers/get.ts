import { apiController } from "@/http/controller";

export default apiController({
  name: "projects.get",
  method: "GET",
  path: "/api/v1/projects/:project",
  route: (request) => ({ operation: "projects.get", payload: {}, projectId: request.params.project }),
});
