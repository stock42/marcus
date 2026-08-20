import { apiController } from "@/http/controller";

export default apiController({
  name: "processes.attach",
  method: "GET",
  path: "/api/v1/projects/:project/processes/:process/attach",
  route: (request) => ({ operation: "processes.attach", payload: { mpid: request.params.process, ...(request.query.after === undefined ? {} : { afterEventSeq: Number(request.query.after) }) }, projectId: request.params.project }),
});
