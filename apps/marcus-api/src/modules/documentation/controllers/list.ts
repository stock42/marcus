import { apiController } from "@/http/controller";

export default apiController({
  name: "documentation.list",
  method: "GET",
  path: "/api/v1/documentation",
  route: { operation: "documentation.list", payload: {} },
});
