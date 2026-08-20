import { apiController } from "@/http/controller";

export default apiController({
  name: "events.list",
  method: "GET",
  path: "/api/v1/projects/:project/events",
  route: (request) => ({
    operation: "events.list",
    payload: (request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }) as Record<string, number>,
    projectId: request.params.project,
  }),
});
