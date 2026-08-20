import { apiController } from "@/http/controller";

export default apiController({
  name: "files.stat",
  method: "GET",
  path: "/api/v1/projects/:project/files/stat",
  route: (request) => ({ operation: "files.stat", payload: { path: request.query.path ?? "" }, projectId: request.params.project }),
});
