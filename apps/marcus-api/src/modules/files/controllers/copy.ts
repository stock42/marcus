import { apiController } from "@/http/controller";

export default apiController({
  name: "files.copy",
  method: "POST",
  path: "/api/v1/projects/:project/files/copy",
  route: (request) => ({ operation: "files.copy", payload: request.body, projectId: request.params.project, status: 201 }),
});
