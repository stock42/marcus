import { apiController } from "@/http/controller";

export default apiController({
  name: "artifacts.list",
  method: "GET",
  path: "/api/v1/projects/:project/artifacts",
  route: (request) => ({
    operation: "artifacts.list",
    payload: (request.query.runId === undefined ? {} : { runId: request.query.runId }) as Record<string, string>,
    projectId: request.params.project,
  }),
});
