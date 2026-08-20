import journey from "@/data/cli-journey.json";

export type TerminalLine = {
  kind: "command" | "prompt" | "output" | "muted" | "annotation";
  value: string;
  command?: string;
  scope?: "shell" | "marcus";
  format?: "json";
};

export type TerminalStep = {
  id: "install" | "start" | "project" | "agent";
  number: string;
  label: string;
  title: string;
  description: string;
  lines: readonly TerminalLine[];
};

export const TERMINAL_STEPS = journey.steps as readonly TerminalStep[];
