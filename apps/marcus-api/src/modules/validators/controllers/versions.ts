import { apiController } from "@/http/controller";

export default apiController({
  name: "validators.versions",
  method: "GET",
  path: "/api/v1/projects/:project/validators/:validator/versions",
  route: (request) => ({ operation: "authValidators.versions", payload: { validator: decodeURIComponent(request.params.validator) }, projectId: request.params.project }),
});
