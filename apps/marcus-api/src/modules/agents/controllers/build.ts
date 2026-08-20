import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.build",
  method: "POST",
  path: "/api/v1/projects/:project/agents/builds",
  route: (request) => ({ operation: "agents.createFromProjectSource", payload: request.body, projectId: request.params.project, status: 201 }),
});
