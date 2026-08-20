import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.start",
  method: "POST",
  path: "/api/v1/projects/:project/agents/:agent/start",
  route: (request) => ({ operation: "agents.start", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
