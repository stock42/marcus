import { apiController } from "@/http/controller";

export default apiController({
  name: "messages.list",
  method: "GET",
  path: "/api/v1/projects/:project/messages",
  route: (request) => ({ operation: "messages.list", payload: request.query, projectId: request.params.project }),
});
