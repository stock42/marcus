import { apiController } from "@/http/controller";

export default apiController({
  name: "users.change-password",
  method: "PATCH",
  path: "/api/v1/users/me/password",
  route: (request) => ({ operation: "users.password.change", payload: request.body }),
});
