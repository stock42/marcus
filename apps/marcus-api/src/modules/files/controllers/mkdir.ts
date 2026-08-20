import { apiController } from "@/http/controller";

export default apiController({
  name: "files.mkdir",
  method: "POST",
  path: "/api/v1/projects/:project/files/directories",
  route: (request) => ({ operation: "files.mkdir", payload: request.body, projectId: request.params.project, status: 201 }),
});
