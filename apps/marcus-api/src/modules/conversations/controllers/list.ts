import { apiController } from "@/http/controller";

export default apiController({
  name: "conversations.list",
  method: "GET",
  path: "/api/v1/projects/:project/conversations",
  route: (request) => ({
    operation: "conversations.list",
    payload: (request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }) as Record<string, number>,
    projectId: request.params.project,
  }),
});
