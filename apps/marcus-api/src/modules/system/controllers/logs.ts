import { apiController, queryValue } from "@/http/controller";

export default apiController({
  name: "system.logs",
  method: "GET",
  path: "/api/v1/system/logs",
  route: (request) => ({
    operation: "system.logs",
    payload: {
      ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }),
      ...(request.query.source === undefined ? {} : { source: queryValue(request.query.source) }),
      ...(request.query.level === undefined ? {} : { level: queryValue(request.query.level) }),
      ...(request.query.q === undefined ? {} : { query: queryValue(request.query.q) }),
    },
  }),
});
