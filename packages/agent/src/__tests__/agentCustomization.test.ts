import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetAgentCustomInstructions } = vi.hoisted(() => ({
  mockGetAgentCustomInstructions: vi.fn(),
}));

vi.mock("@aif/data", () => ({
  getAgentCustomInstructions: mockGetAgentCustomInstructions,
}));

const { withAgentCustomInstructions } = await import("../agentCustomization.js");

describe("withAgentCustomInstructions", () => {
  beforeEach(() => {
    mockGetAgentCustomInstructions.mockReset();
  });

  it("returns base unchanged when no custom instructions are saved", () => {
    mockGetAgentCustomInstructions.mockReturnValue(null);

    const result = withAgentCustomInstructions("BASE", "proj-1", "plan-coordinator");

    expect(result).toBe("BASE");
    expect(mockGetAgentCustomInstructions).toHaveBeenCalledWith("proj-1", "plan-coordinator");
  });

  it("appends the saved custom instructions after base, never replacing it", () => {
    mockGetAgentCustomInstructions.mockReturnValue("Always check for missing rate limits.");

    const result = withAgentCustomInstructions("BASE", "proj-1", "review-sidecar");

    expect(result.startsWith("BASE")).toBe(true);
    expect(result).toContain("Always check for missing rate limits.");
    expect(result).toContain(
      "Additional project-specific instructions for this agent (do not change your required output format or role):",
    );
  });

  it("queries per project and role — different roles get independent instructions", () => {
    mockGetAgentCustomInstructions.mockImplementation((projectId: string, role: string) =>
      role === "implement-coordinator" ? "Log every file write." : null,
    );

    const implementResult = withAgentCustomInstructions("BASE", "proj-1", "implement-coordinator");
    const reviewResult = withAgentCustomInstructions("BASE", "proj-1", "review-sidecar");

    expect(implementResult).toContain("Log every file write.");
    expect(reviewResult).toBe("BASE");
  });
});
