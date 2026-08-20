import { apiController } from "@/http/controller";

export default apiController({
  name: "auth.logout",
  method: "POST",
  path: "/api/v1/auth/logout",
  route: { operation: "auth.logout", payload: {} },
});
