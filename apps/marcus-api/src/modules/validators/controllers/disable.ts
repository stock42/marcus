import { apiController } from "@/http/controller";

export default apiController({
  name: "validators.disable",
  method: "POST",
  path: "/api/v1/projects/:project/validators/:validator/disable",
  route: (request) => ({ operation: "authValidators.disable", payload: { validator: decodeURIComponent(request.params.validator) }, projectId: request.params.project }),
});
