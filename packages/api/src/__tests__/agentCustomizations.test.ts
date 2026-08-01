import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createTestDb } from "@aif/shared/server";
import { projects } from "@aif/shared";

const testDb = { current: createTestDb() };

vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

const { agentCustomizationsRouter } = await import("../routes/agentCustomizations.js");

function createApp() {
  const app = new Hono();
  app.route("/agent-customizations", agentCustomizationsRouter);
  return app;
}

function seedProject(id = "proj-1") {
  testDb.current.insert(projects).values({ id, name: "Test", rootPath: "/tmp/test" }).run();
}

describe("agent customizations routes", () => {
  let app: Hono;

  beforeEach(() => {
    testDb.current = createTestDb();
    seedProject();
    app = createApp();
  });

  it("404s listing customizations for an unknown project", async () => {
    const res = await app.request("/agent-customizations/missing-project");
    expect(res.status).toBe(404);
  });

  it("returns an empty list for a project with no customizations", async () => {
    const res = await app.request("/agent-customizations/proj-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("upserts and lists a customization for a valid role", async () => {
    const putRes = await app.request("/agent-customizations/proj-1/review-sidecar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: "Focus on SQL injection." }),
    });
    expect(putRes.status).toBe(200);
    const created = await putRes.json();
    expect(created.projectId).toBe("proj-1");
    expect(created.agentRole).toBe("review-sidecar");
    expect(created.customInstructions).toBe("Focus on SQL injection.");

    const listRes = await app.request("/agent-customizations/proj-1");
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const updateRes = await app.request("/agent-customizations/proj-1/review-sidecar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: "Focus on SQL injection and XSS." }),
    });
    const updated = await updateRes.json();
    expect(updated.id).toBe(created.id);
    expect(updated.customInstructions).toBe("Focus on SQL injection and XSS.");

    const listAfterUpdateRes = await app.request("/agent-customizations/proj-1");
    expect(await listAfterUpdateRes.json()).toHaveLength(1);
  });

  it("rejects a non-customizable or unknown agent role", async () => {
    const pollisherRes = await app.request("/agent-customizations/proj-1/plan-polisher", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: "test" }),
    });
    expect(pollisherRes.status).toBe(400);

    const unknownRes = await app.request("/agent-customizations/proj-1/not-a-role", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: "test" }),
    });
    expect(unknownRes.status).toBe(400);
  });

  it("404s upserting for an unknown project", async () => {
    const res = await app.request("/agent-customizations/missing-project/review-sidecar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: "test" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects instructions longer than the 4000 character limit", async () => {
    const res = await app.request("/agent-customizations/proj-1/review-sidecar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: "a".repeat(4001) }),
    });
    expect(res.status).toBe(400);
  });
});
