import { apiController } from "@/http/controller";

export default apiController({
  name: "processes.get",
  method: "GET",
  path: "/api/v1/projects/:project/processes/:process",
  route: (request) => ({ operation: "processes.get", payload: { mpid: request.params.process }, projectId: request.params.project }),
});
