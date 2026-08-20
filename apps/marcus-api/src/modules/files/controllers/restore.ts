import { apiController } from "@/http/controller";

export default apiController({
  name: "files.restore",
  method: "POST",
  path: "/api/v1/projects/:project/files/restore",
  route: (request) => ({ operation: "files.restore", payload: request.body, projectId: request.params.project }),
});
