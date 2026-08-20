import { apiController } from "@/http/controller";

export default apiController({
  name: "files.list",
  method: "GET",
  path: "/api/v1/projects/:project/files",
  route: (request) => ({ operation: "files.list", payload: { path: request.query.path ?? "project:/" }, projectId: request.params.project }),
});
