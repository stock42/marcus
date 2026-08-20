import { apiController } from "@/http/controller";

export default apiController({
  name: "uploads.open",
  method: "POST",
  path: "/api/v1/projects/:project/uploads",
  route: (request) => ({ operation: "uploads.open", payload: request.body, projectId: request.params.project, status: 201 }),
});
