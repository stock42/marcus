import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.diff",
  method: "GET",
  path: "/api/v1/projects/:project/agents/:agent/diff",
  route: (request) => ({ operation: "agents.diff", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
