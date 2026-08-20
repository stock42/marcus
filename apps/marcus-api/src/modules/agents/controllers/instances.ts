import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.instances",
  method: "GET",
  path: "/api/v1/projects/:project/agents/:agent/instances",
  route: (request) => ({ operation: "agents.instances", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
