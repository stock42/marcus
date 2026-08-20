import { apiController } from "@/http/controller";

export default apiController({
  name: "uploads.abort",
  method: "DELETE",
  path: "/api/v1/projects/:project/uploads/:upload",
  route: (request) => ({ operation: "uploads.abort", payload: { uploadId: request.params.upload }, projectId: request.params.project }),
});
