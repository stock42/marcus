import { apiController } from "@/http/controller";

export default apiController({
  name: "model-roles.delete",
  method: "DELETE",
  path: "/api/v1/model-roles/:role",
  route: (request) => ({ operation: "modelRoles.delete", payload: { role: decodeURIComponent(request.params.role) } }),
});
