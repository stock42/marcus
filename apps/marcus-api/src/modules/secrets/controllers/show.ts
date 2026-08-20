import { apiController } from "@/http/controller";

export default apiController({
  name: "secrets.show",
  method: "GET",
  path: "/api/v1/projects/:project/secrets/:secret",
  route: (request) => ({ operation: "secrets.show", payload: { name: decodeURIComponent(request.params.secret) }, projectId: request.params.project }),
});
