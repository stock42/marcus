import { apiController } from "@/http/controller";

export default apiController({
  name: "tokens.list",
  method: "GET",
  path: "/api/v1/tokens",
  route: { operation: "tokens.list", payload: {} },
});
