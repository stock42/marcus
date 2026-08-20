import { apiController } from "@/http/controller";

export default apiController({
  name: "validators.test",
  method: "POST",
  path: "/api/v1/projects/:project/validators/:validator/test",
  route: (request) => ({ operation: "authValidators.test", payload: { ...request.body, validator: decodeURIComponent(request.params.validator) }, projectId: request.params.project }),
});
