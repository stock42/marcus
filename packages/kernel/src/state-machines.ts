import { MarcusError, type AgentInstanceState, type RunState } from "@marcus/contracts";

const runTransitions: Readonly<Record<RunState, readonly RunState[]>> = {
  accepted: ["queued", "starting", "cancelled"],
  queued: ["starting", "cancelling", "cancelled", "timed_out"],
  starting: ["running", "cancelling", "failed", "timed_out", "killed"],
  running: [
    "waiting_for_input",
    "waiting_for_approval",
    "waiting_for_child",
    "cancelling",
    "completed",
    "failed",
    "timed_out",
    "killed",
  ],
  waiting_for_input: ["running", "cancelling", "failed", "timed_out", "killed"],
  waiting_for_approval: ["running", "cancelling", "failed", "timed_out", "killed"],
  waiting_for_child: ["running", "cancelling", "failed", "timed_out", "killed"],
  cancelling: ["cancelled", "killed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  killed: [],
};

const instanceTransitions: Readonly<Record<AgentInstanceState, readonly AgentInstanceState[]>> = {
  created: ["queued", "starting", "stopped"],
  queued: ["starting", "stopping", "failed"],
  starting: ["initializing", "failed", "stopping", "killed"],
  initializing: ["ready", "failed", "stopping", "killed"],
  ready: ["running", "waiting", "paused", "stopping", "failed", "killed"],
  running: ["ready", "waiting", "paused", "stopping", "failed", "killed"],
  waiting: ["ready", "running", "paused", "stopping", "failed", "killed"],
  paused: ["ready", "running", "waiting", "stopping", "failed", "killed"],
  stopping: ["stopped", "failed", "killed", "zombie"],
  stopped: [],
  failed: [],
  killed: [],
  orphaned: ["stopping", "stopped", "killed", "zombie"],
  zombie: ["killed"],
};

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return runTransitions[from].includes(to);
}

export function assertRunTransition(from: RunState, to: RunState): void {
  if (!canTransitionRun(from, to)) {
    throw new MarcusError({
      code: "RUN_TRANSITION_INVALID",
      message: `Run cannot transition from ${from} to ${to}`,
      retryable: false,
    });
  }
}

export function canTransitionInstance(from: AgentInstanceState, to: AgentInstanceState): boolean {
  return instanceTransitions[from].includes(to);
}

export function assertInstanceTransition(from: AgentInstanceState, to: AgentInstanceState): void {
  if (!canTransitionInstance(from, to)) {
    throw new MarcusError({
      code: "INSTANCE_TRANSITION_INVALID",
      message: `Instance cannot transition from ${from} to ${to}`,
      retryable: false,
    });
  }
}

export function isTerminalRunState(state: RunState): boolean {
  return runTransitions[state].length === 0;
}
