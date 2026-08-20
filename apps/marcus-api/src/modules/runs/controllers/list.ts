import { apiController } from "@/http/controller";

export default apiController({
  name: "runs.list",
  method: "GET",
  path: "/api/v1/projects/:project/runs",
  route: (request) => ({
    operation: "runs.list",
    payload: (request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }) as Record<string, number>,
    projectId: request.params.project,
  }),
});
