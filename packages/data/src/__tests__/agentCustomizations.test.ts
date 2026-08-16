import { describe, it, expect, beforeEach, vi } from "vitest";
import { projects } from "@aif/shared";
import { createTestDb } from "@aif/shared/server";

const testDb = { current: createTestDb() };
vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

const dataModule = await import("../index.js");

const {
  listAgentCustomizations,
  listAgentCustomizationResponses,
  upsertAgentCustomization,
  getAgentCustomInstructions,
  toAgentCustomizationResponse,
} = dataModule;

function seedProject(id = "proj-1") {
  testDb.current
    .insert(projects)
    .values({ id, name: "Test", rootPath: "/tmp/test" })
    .run();
}

describe("agent customizations data layer", () => {
  beforeEach(() => {
    testDb.current = createTestDb();
    seedProject();
    seedProject("proj-2");
  });

  it("returns null when no customization exists", () => {
    expect(getAgentCustomInstructions("proj-1", "review-sidecar")).toBeNull();
  });

  it("creates a customization on first upsert", () => {
    const row = upsertAgentCustomization({
      projectId: "proj-1",
      agentRole: "plan-coordinator",
      customInstructions: "Always ask about database migrations.",
    });

    expect(row.projectId).toBe("proj-1");
    expect(row.agentRole).toBe("plan-coordinator");
    expect(row.customInstructions).toBe("Always ask about database migrations.");
    expect(getAgentCustomInstructions("proj-1", "plan-coordinator")).toBe(
      "Always ask about database migrations.",
    );
  });

  it("updates in place on repeated upsert for the same project + role", () => {
    upsertAgentCustomization({
      projectId: "proj-1",
      agentRole: "review-sidecar",
      customInstructions: "Focus on SQL injection.",
    });
    const updated = upsertAgentCustomization({
      projectId: "proj-1",
      agentRole: "review-sidecar",
      customInstructions: "Focus on SQL injection and XSS.",
    });

    const rows = listAgentCustomizations("proj-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(updated.id);
    expect(rows[0].customInstructions).toBe("Focus on SQL injection and XSS.");
  });

  it("scopes customizations per project", () => {
    upsertAgentCustomization({
      projectId: "proj-1",
      agentRole: "security-sidecar",
      customInstructions: "proj-1 instructions",
    });
    upsertAgentCustomization({
      projectId: "proj-2",
      agentRole: "security-sidecar",
      customInstructions: "proj-2 instructions",
    });

    expect(getAgentCustomInstructions("proj-1", "security-sidecar")).toBe("proj-1 instructions");
    expect(getAgentCustomInstructions("proj-2", "security-sidecar")).toBe("proj-2 instructions");
  });

  it("treats blank instructions as no customization", () => {
    upsertAgentCustomization({
      projectId: "proj-1",
      agentRole: "implement-coordinator",
      customInstructions: "   ",
    });

    expect(getAgentCustomInstructions("proj-1", "implement-coordinator")).toBeNull();
  });

  it("lists and maps customization responses for a project", () => {
    upsertAgentCustomization({
      projectId: "proj-1",
      agentRole: "plan-coordinator",
      customInstructions: "a",
    });
    upsertAgentCustomization({
      projectId: "proj-1",
      agentRole: "implement-coordinator",
      customInstructions: "b",
    });

    const responses = listAgentCustomizationResponses("proj-1");
    expect(responses).toHaveLength(2);
    expect(responses.map((r) => r.agentRole).sort()).toEqual([
      "implement-coordinator",
      "plan-coordinator",
    ]);
  });

  it("maps a raw row to its response shape", () => {
    const row = upsertAgentCustomization({
      projectId: "proj-1",
      agentRole: "plan-coordinator",
      customInstructions: "c",
    });

    expect(toAgentCustomizationResponse(row)).toEqual({
      id: row.id,
      projectId: "proj-1",
      agentRole: "plan-coordinator",
      customInstructions: "c",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });
});
