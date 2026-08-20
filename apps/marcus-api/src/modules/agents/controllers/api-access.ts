import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.setApiAccess",
  method: "PATCH",
  path: "/api/v1/projects/:project/agents/:agent/api-access",
  route: (request) => ({ operation: "agents.setApiAccess", payload: { ...request.body, agent: request.params.agent }, projectId: request.params.project }),
});
