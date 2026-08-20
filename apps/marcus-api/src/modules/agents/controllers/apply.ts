import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.apply",
  method: "POST",
  path: "/api/v1/projects/:project/agents/:agent/apply",
  route: (request) => ({ operation: "agents.apply", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
