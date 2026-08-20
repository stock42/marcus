import { apiController } from "@/http/controller";

export default apiController({
  name: "secrets.set",
  method: "PUT",
  path: "/api/v1/projects/:project/secrets/:secret",
  route: (request) => ({ operation: "secrets.set", payload: { ...request.body, name: decodeURIComponent(request.params.secret) }, projectId: request.params.project }),
});
