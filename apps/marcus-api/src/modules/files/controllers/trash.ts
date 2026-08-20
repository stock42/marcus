import { apiController } from "@/http/controller";

export default apiController({
  name: "files.trash",
  method: "DELETE",
  path: "/api/v1/projects/:project/files",
  route: (request) => ({ operation: "files.trash", payload: { path: request.query.path ?? "" }, projectId: request.params.project }),
});
