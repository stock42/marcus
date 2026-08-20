import { apiController } from "@/http/controller";

export default apiController({
  name: "providers.test",
  method: "POST",
  path: "/api/v1/providers/:provider/test",
  route: (request) => ({ operation: "providers.test", payload: { provider: request.params.provider } }),
});
