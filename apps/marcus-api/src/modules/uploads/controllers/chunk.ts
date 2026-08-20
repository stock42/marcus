import { apiController } from "@/http/controller";

export default apiController({
  name: "uploads.chunk",
  method: "PUT",
  path: "/api/v1/projects/:project/uploads/:upload/chunks/:offset",
  route: (request) => ({ operation: "uploads.chunk", payload: { ...request.body, uploadId: request.params.upload, offset: Number(request.params.offset ?? request.body.offset ?? 0) }, projectId: request.params.project }),
});
