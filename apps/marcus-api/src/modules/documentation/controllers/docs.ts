import { apiController } from "@/http/controller";

export default apiController({
  name: "documentation.docs",
  method: "GET",
  path: "/api/v1/docs",
  route: { operation: "docs", payload: {}, public: true },
});
