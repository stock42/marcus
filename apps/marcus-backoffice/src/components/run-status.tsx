import { Badge } from "@/components/ui/badge";
import type { Run } from "@/lib/marcus/types";

export function RunStatus({ state }: { state: Run["state"] }) {
  const successful = state === "completed";
  const destructive = state === "failed" || state === "timed_out" || state === "killed";
  return <Badge variant={successful ? "default" : destructive ? "destructive" : isTerminalRun(state) ? "secondary" : "outline"}>{state.replaceAll("_", " ")}</Badge>;
}

export function isTerminalRun(state: Run["state"]): boolean {
  return ["completed", "failed", "cancelled", "timed_out", "killed"].includes(state);
}
