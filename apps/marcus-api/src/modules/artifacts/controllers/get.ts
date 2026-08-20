import { apiController } from "@/http/controller";

export default apiController({
  name: "artifacts.get",
  method: "GET",
  path: "/api/v1/projects/:project/artifacts/:artifact",
  route: (request) => ({ operation: "artifacts.read", payload: { artifactId: request.params.artifact }, projectId: request.params.project, binary: true }),
});
