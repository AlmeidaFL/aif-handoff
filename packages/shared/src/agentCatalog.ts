// Static catalog of the built-in agent roles that power the Kanban pipeline.
// Pure data, no Node.js dependencies — safe to import from both server and browser code.

export type AgentRole =
  | "plan-coordinator"
  | "plan-polisher"
  | "implement-coordinator"
  | "implement-worker"
  | "review-sidecar"
  | "security-sidecar";

export type CustomizableAgentRole =
  | "plan-coordinator"
  | "implement-coordinator"
  | "review-sidecar"
  | "security-sidecar";

export interface AgentCatalogEntry {
  role: AgentRole;
  label: string;
  stage: "planning" | "implementing" | "review";
  description: string;
  limitations: string;
  customizable: boolean;
  nonCustomizableReason?: string;
}

export const CUSTOMIZABLE_AGENT_ROLES: CustomizableAgentRole[] = [
  "plan-coordinator",
  "implement-coordinator",
  "review-sidecar",
  "security-sidecar",
];

export function isCustomizableAgentRole(role: string): role is CustomizableAgentRole {
  return (CUSTOMIZABLE_AGENT_ROLES as string[]).includes(role);
}

export const AGENT_CATALOG: AgentCatalogEntry[] = [
  {
    role: "plan-coordinator",
    label: "Plan Coordinator",
    stage: "planning",
    description:
      "Drives Backlog → Planning → Plan Ready. Reads the task and repo, and produces the implementation-ready markdown plan a human approves before implementation starts.",
    limitations:
      "Reads and writes only inside the task's plan file. Delegates iterative refinement to plan-polisher.",
    customizable: true,
  },
  {
    role: "plan-polisher",
    label: "Plan Polisher",
    stage: "planning",
    description:
      "Spawned by plan-coordinator to iteratively refine the plan before it's marked ready.",
    limitations: "Runs only as a child of plan-coordinator; has no independent invocation point.",
    customizable: false,
    nonCustomizableReason:
      "Spawned automatically by plan-coordinator as a native subagent; inherits plan-coordinator's instructions instead of running with its own per-project append.",
  },
  {
    role: "implement-coordinator",
    label: "Implement Coordinator",
    stage: "implementing",
    description:
      "Drives Plan Ready → Implementing → Review. Executes the approved plan directly for single tasks, or dispatches parallel implement-worker subagents across git worktrees for independent plan tasks.",
    limitations: "Can read, write, and run commands within the task's worktree scope only.",
    customizable: true,
  },
  {
    role: "implement-worker",
    label: "Implement Worker",
    stage: "implementing",
    description:
      "Spawned by implement-coordinator to execute one independent plan task in parallel.",
    limitations:
      "Runs only as a child of implement-coordinator; has no independent invocation point.",
    customizable: false,
    nonCustomizableReason:
      "Spawned automatically by implement-coordinator as a native subagent; inherits implement-coordinator's instructions instead of running with its own per-project append.",
  },
  {
    role: "review-sidecar",
    label: "Review Sidecar",
    stage: "review",
    description:
      "Runs in the Review stage in parallel with security-sidecar. Surfaces correctness, regression, performance, and maintainability risks in the implemented change.",
    limitations:
      "Read-only — never edits files. Must always emit a Verdict (PASS/WARN/FAIL) plus Blocking findings; the auto-review gate parses this structured output to decide whether the task can proceed.",
    customizable: true,
  },
  {
    role: "security-sidecar",
    label: "Security Sidecar",
    stage: "review",
    description:
      "Runs in the Review stage in parallel with review-sidecar. Performs a security-focused audit of the implemented change.",
    limitations:
      "Read-only — never edits files. Must always emit a Verdict (PASS/WARN/FAIL) plus Blocking findings; the auto-review gate parses this structured output to decide whether the task can proceed.",
    customizable: true,
  },
];
