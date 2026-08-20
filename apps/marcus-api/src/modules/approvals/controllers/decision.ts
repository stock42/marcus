import { apiController } from "@/http/controller";

export default apiController({
  name: "approvals.decision",
  method: "POST",
  path: "/api/v1/projects/:project/approvals/:approval/decision",
  route: (request) => ({ operation: "approvals.decide", payload: { ...request.body, approvalId: request.params.approval }, projectId: request.params.project }),
});
