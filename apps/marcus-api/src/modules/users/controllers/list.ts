import { apiController } from "@/http/controller";

export default apiController({
  name: "users.list",
  method: "GET",
  path: "/api/v1/users",
  route: { operation: "users.list", payload: {} },
});
