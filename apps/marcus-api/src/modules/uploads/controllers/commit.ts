import { apiController } from "@/http/controller";

export default apiController({
  name: "uploads.commit",
  method: "POST",
  path: "/api/v1/projects/:project/uploads/:upload/commit",
  route: (request) => ({ operation: "uploads.commit", payload: { ...request.body, uploadId: request.params.upload }, projectId: request.params.project }),
});
