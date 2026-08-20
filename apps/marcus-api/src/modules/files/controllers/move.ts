import { apiController } from "@/http/controller";

export default apiController({
  name: "files.move",
  method: "POST",
  path: "/api/v1/projects/:project/files/move",
  route: (request) => ({ operation: "files.move", payload: request.body, projectId: request.params.project }),
});
