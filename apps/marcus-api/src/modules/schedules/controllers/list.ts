import { apiController } from "@/http/controller";

export default apiController({
  name: "schedules.list",
  method: "GET",
  path: "/api/v1/projects/:project/schedules",
  route: (request) => ({ operation: "schedules.list", payload: {}, projectId: request.params.project }),
});
