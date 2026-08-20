import { apiController } from "@/http/controller";

export default apiController({
  name: "processes.kill",
  method: "POST",
  path: "/api/v1/projects/:project/processes/:process/kill",
  route: (request) => ({ operation: "processes.kill", payload: { mpid: request.params.process }, projectId: request.params.project }),
});
