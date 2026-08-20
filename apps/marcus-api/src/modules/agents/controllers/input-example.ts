import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.input-example",
  method: "POST",
  path: "/api/v1/projects/:project/agents/:agent/input-example",
  route: (request) => ({
    operation: "agents.generateInputExample",
    payload: { agent: request.params.agent },
    projectId: request.params.project,
    timeoutMs: 60_000,
  }),
});
