import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.list",
  method: "GET",
  path: "/api/v1/projects/:project/agents",
  route: (request) => ({ operation: "agents.list", payload: {}, projectId: request.params.project }),
});
