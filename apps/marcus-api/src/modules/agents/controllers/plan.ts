import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.plan",
  method: "POST",
  path: "/api/v1/projects/:project/agents/plan",
  route: (request) => ({ operation: "agents.plan", payload: request.body, projectId: request.params.project, status: 202 }),
});
