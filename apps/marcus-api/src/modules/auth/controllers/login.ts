import { apiController } from "@/http/controller";

export default apiController({
  name: "auth.login",
  method: "POST",
  path: "/api/v1/auth/login",
  route: { operation: "auth.login", payload: {}, public: true },
});
