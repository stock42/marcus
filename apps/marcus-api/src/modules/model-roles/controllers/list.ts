import { apiController } from "@/http/controller";

export default apiController({
  name: "model-roles.list",
  method: "GET",
  path: "/api/v1/model-roles",
  route: { operation: "modelRoles.list", payload: {} },
});
