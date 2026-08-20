import { apiController } from "@/http/controller";

export default apiController({
  name: "auth.session",
  method: "GET",
  path: "/api/v1/auth/session",
  route: { operation: "auth.session", payload: {}, public: true },
});
