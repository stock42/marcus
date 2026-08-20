import { apiController } from "@/http/controller";

export default apiController({
  name: "documentation.read",
  method: "GET",
  path: "/api/v1/documentation/:name",
  route: (request) => ({ operation: "documentation.read", payload: { name: request.params.name } }),
});
