import { apiController } from "@/http/controller";

export default apiController({
  name: "agents.generation-progress",
  method: "GET",
  path: "/api/v1/projects/:project/agents/generations/:progressId",
  route: (request) => ({
    operation: "agents.generationProgress",
    payload: { progressId: request.params.progressId },
    projectId: request.params.project,
  }),
});
