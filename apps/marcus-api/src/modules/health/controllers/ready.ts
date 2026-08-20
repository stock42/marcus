import { apiController } from "@/http/controller";

export default apiController({
  name: "health.ready",
  method: "GET",
  path: "/health/ready",
  route: { operation: "health.ready", payload: {}, public: true },
});
