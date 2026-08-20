import { apiController } from "@/http/controller";

export default apiController({
  name: "validators.list",
  method: "GET",
  path: "/api/v1/projects/:project/validators",
  route: (request) => ({ operation: "authValidators.list", payload: {}, projectId: request.params.project }),
});
