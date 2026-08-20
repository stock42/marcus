import { apiController } from "@/http/controller";

export default apiController({
  name: "files.sync-open",
  method: "POST",
  path: "/api/v1/projects/:project/files/sync/open",
  route: (request) => ({ operation: "files.sync.open", payload: request.body, projectId: request.params.project, status: 201 }),
});
