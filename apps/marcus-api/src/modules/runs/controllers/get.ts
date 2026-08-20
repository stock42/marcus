import { apiController } from "@/http/controller";

export default apiController({
  name: "runs.get",
  method: "GET",
  path: "/api/v1/projects/:project/runs/:run",
  route: (request) => ({ operation: "runs.get", payload: { runId: request.params.run }, projectId: request.params.project }),
});
