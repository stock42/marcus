import { apiController } from "@/http/controller";

export default apiController({
  name: "backups.list",
  method: "GET",
  path: "/api/v1/backups",
  route: { operation: "backups.list", payload: {} },
});
