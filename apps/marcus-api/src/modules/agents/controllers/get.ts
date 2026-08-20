import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.get",
  method: "GET",
  path: "/api/v1/projects/:project/agents/:agent",
  route: (request) => ({ operation: "agents.get", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
