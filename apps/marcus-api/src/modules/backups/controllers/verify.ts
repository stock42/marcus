import { apiController } from "@/http/controller";

export default apiController({
  name: "backups.verify",
  method: "POST",
  path: "/api/v1/backups/verify",
  route: (request) => ({ operation: "backups.verify", payload: request.body }),
});
