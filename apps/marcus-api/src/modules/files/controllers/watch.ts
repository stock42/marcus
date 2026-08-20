import { apiController } from "@/http/controller";

export default apiController({
  name: "files.watch",
  method: "GET",
  path: "/api/v1/projects/:project/files/watch",
  route: (request) => ({ operation: "files.watch", payload: { path: request.query.path ?? "project:/", ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }) }, projectId: request.params.project }),
});
