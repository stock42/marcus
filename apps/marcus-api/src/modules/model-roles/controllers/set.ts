import { apiController } from "@/http/controller";

export default apiController({
  name: "model-roles.set",
  method: "PUT",
  path: "/api/v1/model-roles/:role",
  route: (request) => ({ operation: "modelRoles.set", payload: { ...request.body, role: decodeURIComponent(request.params.role) } }),
});
