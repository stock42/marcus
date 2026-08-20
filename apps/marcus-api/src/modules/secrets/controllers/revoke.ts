import { apiController } from "@/http/controller";

export default apiController({
  name: "secrets.revoke",
  method: "DELETE",
  path: "/api/v1/projects/:project/secrets/:secret",
  route: (request) => ({ operation: "secrets.revoke", payload: { name: decodeURIComponent(request.params.secret) }, projectId: request.params.project }),
});
