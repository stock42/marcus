import { apiController } from "@/http/controller";

export default apiController({
  name: "files.write",
  method: "PUT",
  path: "/api/v1/projects/:project/files/content",
  route: (request) => ({ operation: "files.write", payload: { ...request.body, path: request.query.path ?? request.body.path ?? "" }, projectId: request.params.project }),
});
