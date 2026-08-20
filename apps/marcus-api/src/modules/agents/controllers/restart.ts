import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.restart",
  method: "POST",
  path: "/api/v1/projects/:project/agents/:agent/restart",
  route: (request) => ({ operation: "agents.restart", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
