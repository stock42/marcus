import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.contract",
  method: "GET",
  path: "/api/v1/projects/:project/agents/:agent/contract",
  route: (request) => ({ operation: "agents.contract", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
