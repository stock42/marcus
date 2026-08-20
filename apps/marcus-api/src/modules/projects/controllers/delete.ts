import { apiController } from "@/http/controller";

export default apiController({
  name: "projects.delete",
  method: "DELETE",
  path: "/api/v1/projects/:project",
  route: (request) => ({ operation: "projects.delete", payload: {}, projectId: request.params.project }),
});
