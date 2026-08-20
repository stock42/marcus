import { apiController } from "@/http/controller";

export default apiController({
  name: "conversations.messages",
  method: "GET",
  path: "/api/v1/projects/:project/conversations/:conversation/messages",
  route: (request) => ({ operation: "conversations.messages", payload: { conversationId: request.params.conversation, ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }) }, projectId: request.params.project }),
});
