import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.invoke",
  method: "POST",
  path: "/api/v1/projects/:project/agents/:agent/invoke",
  route: (request) => ({ operation: "agent.invoke", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
