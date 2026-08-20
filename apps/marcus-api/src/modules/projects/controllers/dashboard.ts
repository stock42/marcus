import { apiController } from "@/http/controller";

export default apiController({
  name: "projects.dashboard",
  method: "GET",
  path: "/api/v1/projects/:project/dashboard",
  route: (request) => ({ operation: "projects.dashboard", payload: {}, projectId: request.params.project }),
});
