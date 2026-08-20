import { apiController } from "@/http/controller";

export default apiController({
  name: "assistant.chat",
  method: "POST",
  path: "/api/v1/assistant/chat",
  route: (request) => ({
    operation: "assistant.chat",
    payload: request.body,
    ...(typeof request.body.projectId === "string" ? { projectId: request.body.projectId } : {}),
    status: 202,
  }),
});
