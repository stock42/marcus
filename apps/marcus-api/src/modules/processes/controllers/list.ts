import { apiController } from "@/http/controller";

export default apiController({
  name: "processes.list",
  method: "GET",
  path: "/api/v1/projects/:project/processes",
  route: (request) => ({
    operation: "processes.list",
    payload: {
      ...request.query,
      ...(request.query.includeTerminal === undefined
        ? {}
        : { includeTerminal: request.query.includeTerminal !== "false" }),
    },
    projectId: request.params.project,
  }),
});
