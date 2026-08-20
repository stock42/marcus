import { apiController } from "@/http/controller";

export default apiController({
  name: "uploads.resume",
  method: "GET",
  path: "/api/v1/projects/:project/uploads/:upload",
  route: (request) => ({ operation: "uploads.resume", payload: { uploadId: request.params.upload }, projectId: request.params.project }),
});
