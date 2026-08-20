import { apiController } from "@/http/controller";

export default apiController({
  name: "health.live",
  method: "GET",
  path: "/health/live",
  route: { operation: "health.live", payload: {}, public: true },
});
