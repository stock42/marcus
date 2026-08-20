import { apiController } from "@/http/controller";

export default apiController({
  name: "backups.create",
  method: "POST",
  path: "/api/v1/backups",
  route: (request) => ({ operation: "backups.create", payload: request.body, status: 201 }),
});
