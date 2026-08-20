import { apiController } from "@/http/controller";

export default apiController({
  name: "files.read",
  method: "GET",
  path: "/api/v1/projects/:project/files/content",
  route: (request) => ({ operation: "files.read", payload: { path: request.query.path ?? "project:/" }, projectId: request.params.project }),
});
