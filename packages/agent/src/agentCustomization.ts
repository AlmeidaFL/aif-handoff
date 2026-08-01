import { getAgentCustomInstructions } from "@aif/data";
import type { CustomizableAgentRole } from "@aif/shared";

/**
 * Appends the project's stored custom instructions (if any) for a given
 * built-in agent role to a base systemPromptAppend string. Purely additive —
 * never replaces `base`, so the role's required output contract (e.g. the
 * review-sidecar/security-sidecar structured findings format, which lives in
 * the prompt body, not here) is always unaffected.
 *
 * Applies regardless of `useSubagents` — the same logical role runs whether
 * invoked as a native agent definition or via its skill/slash-command
 * fallback, so the project's custom instructions for that role should apply
 * either way.
 */
export function withAgentCustomInstructions(
  base: string,
  projectId: string,
  agentRole: CustomizableAgentRole,
): string {
  const custom = getAgentCustomInstructions(projectId, agentRole);
  if (!custom) return base;
  return `${base}\n\nAdditional project-specific instructions for this agent (do not change your required output format or role):\n${custom}`;
}
