import { apiController } from "@/http/controller";

export default apiController({
  name: "documentation.openapi",
  method: "GET",
  path: "/api/v1/openapi.json",
  route: (request) => ({ operation: "openapi", payload: {}, public: true, ...(request.query.projectId === undefined ? {} : { projectId: request.query.projectId }) }),
});
