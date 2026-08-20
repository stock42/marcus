import { apiController } from "@/http/controller";

export default apiController({
  name: "validators.activate",
  method: "POST",
  path: "/api/v1/projects/:project/validators/:validator/activate",
  route: (request) => ({ operation: "authValidators.activate", payload: { ...request.body, validator: decodeURIComponent(request.params.validator) }, projectId: request.params.project }),
});
