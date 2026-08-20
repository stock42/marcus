import { apiController } from "@/http/controller";

export default apiController({
  name: "runs.cancel",
  method: "POST",
  path: "/api/v1/projects/:project/runs/:run/cancel",
  route: (request) => ({ operation: "runs.cancel", payload: { runId: request.params.run }, projectId: request.params.project }),
});
