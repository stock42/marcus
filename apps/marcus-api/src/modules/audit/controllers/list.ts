import { apiController } from "@/http/controller";

export default apiController({
  name: "audit.list",
  method: "GET",
  path: "/api/v1/projects/:project/audit",
  route: (request) => ({
    operation: "audit.list",
    payload: (request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }) as Record<string, number>,
    projectId: request.params.project,
  }),
});
