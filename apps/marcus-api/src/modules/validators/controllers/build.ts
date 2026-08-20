import { apiController } from "@/http/controller";

export default apiController({
  name: "validators.build",
  method: "POST",
  path: "/api/v1/projects/:project/validators/builds",
  route: (request) => ({ operation: "authValidators.createFromProjectSource", payload: request.body, projectId: request.params.project, status: 201 }),
});
