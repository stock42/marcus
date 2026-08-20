import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.compiled",
  method: "GET",
  path: "/api/v1/projects/:project/agents/:agent/versions/:version/compiled",
  route: (request) => ({
    operation: "agents.compiled",
    payload: { agent: request.params.agent, agentVersionId: request.params.version },
    projectId: request.params.project,
  }),
});
