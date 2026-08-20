import { apiController } from "@/http/controller";

export default apiController({
  name: "providers.list",
  method: "GET",
  path: "/api/v1/providers",
  route: { operation: "providers.list", payload: {} },
});
