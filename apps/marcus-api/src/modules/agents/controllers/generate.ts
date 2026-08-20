import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.generate",
  method: "POST",
  path: "/api/v1/projects/:project/agents/generate",
  route: (request) => ({ operation: "agents.generateMarkdown", payload: request.body, projectId: request.params.project, status: 202 }),
});
