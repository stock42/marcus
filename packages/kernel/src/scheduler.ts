export type SchedulerPriority = "system-critical" | "interactive" | "normal" | "background" | "maintenance";

export interface ScheduledRun {
  runId: string;
  projectId: string;
  agentId: string;
  priority: SchedulerPriority;
  acceptedAtMs: number;
  deadlineAtMs?: number;
}

const priorityWeight: Readonly<Record<SchedulerPriority, number>> = {
  "system-critical": 5,
  interactive: 4,
  normal: 3,
  background: 2,
  maintenance: 1,
};

export class FairScheduler {
  private readonly queues = new Map<string, ScheduledRun[]>();
  private cursor = 0;

  enqueue(run: ScheduledRun): void {
    const queue = this.queues.get(run.projectId) ?? [];
    queue.push(run);
    queue.sort(compareRuns);
    this.queues.set(run.projectId, queue);
  }

  dequeue(predicate: (run: ScheduledRun) => boolean = () => true): ScheduledRun | undefined {
    const projects = [...this.queues.keys()].sort();
    if (projects.length === 0) return undefined;
    for (let checked = 0; checked < projects.length; checked += 1) {
      const index = (this.cursor + checked) % projects.length;
      const project = projects[index]!;
      const queue = this.queues.get(project)!;
      const runIndex = queue.findIndex(predicate);
      if (runIndex < 0) continue;
      const [run] = queue.splice(runIndex, 1);
      if (queue.length === 0) this.queues.delete(project);
      this.cursor = (index + 1) % Math.max(projects.length, 1);
      return run;
    }
    return undefined;
  }

  remove(runId: string): boolean {
    for (const [project, queue] of this.queues) {
      const index = queue.findIndex((run) => run.runId === runId);
      if (index < 0) continue;
      queue.splice(index, 1);
      if (queue.length === 0) this.queues.delete(project);
      return true;
    }
    return false;
  }

  get size(): number {
    let total = 0;
    for (const queue of this.queues.values()) total += queue.length;
    return total;
  }
}

function compareRuns(left: ScheduledRun, right: ScheduledRun): number {
  const deadline = (left.deadlineAtMs ?? Number.POSITIVE_INFINITY) - (right.deadlineAtMs ?? Number.POSITIVE_INFINITY);
  if (deadline !== 0) return deadline;
  const priority = priorityWeight[right.priority] - priorityWeight[left.priority];
  return priority === 0 ? left.acceptedAtMs - right.acceptedAtMs : priority;
}
