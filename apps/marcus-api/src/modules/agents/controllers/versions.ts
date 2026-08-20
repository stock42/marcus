import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.versions",
  method: "GET",
  path: "/api/v1/projects/:project/agents/:agent/versions",
  route: (request) => ({ operation: "agents.versions", payload: { agent: request.params.agent }, projectId: request.params.project }),
});
