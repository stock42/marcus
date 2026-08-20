import { apiController } from "@/http/controller";

export default apiController({
  name: "runs.attach",
  method: "GET",
  path: "/api/v1/projects/:project/runs/:run/attach",
  route: (request) => ({ operation: "runs.attach", payload: { runId: request.params.run, ...(request.query.after === undefined ? {} : { afterEventSeq: Number(request.query.after) }) }, projectId: request.params.project }),
});
