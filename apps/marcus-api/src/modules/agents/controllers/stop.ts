import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.stop",
  method: "POST",
  path: "/api/v1/projects/:project/agents/:agent/stop",
  route: (request) => ({ operation: "agents.stop", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
