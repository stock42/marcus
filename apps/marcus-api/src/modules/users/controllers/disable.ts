import { apiController } from "@/http/controller";

export default apiController({
  name: "users.disable",
  method: "POST",
  path: "/api/v1/users/:user/disable",
  route: (request) => ({ operation: "users.disable", payload: { user: request.params.user } }),
});
