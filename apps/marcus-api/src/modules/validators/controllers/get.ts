import { apiController } from "@/http/controller";

export default apiController({
  name: "validators.get",
  method: "GET",
  path: "/api/v1/projects/:project/validators/:validator",
  route: (request) => ({ operation: "authValidators.get", payload: { validator: decodeURIComponent(request.params.validator) }, projectId: request.params.project }),
});
