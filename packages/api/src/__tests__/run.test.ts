import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createTestDb } from "@aif/shared/server";
import { projects, tasks } from "@aif/shared";

const testDb = { current: createTestDb() };
const mockInternalBroadcastToken = { value: "" };

vi.mock("@aif/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared")>();
  const resolvedEnv = actual.getEnv();
  return {
    ...actual,
    getEnv: () => ({
      ...resolvedEnv,
      INTERNAL_BROADCAST_TOKEN: mockInternalBroadcastToken.value,
    }),
  };
});

vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}));

const { runRouter } = await import("../routes/run.js");
const { broadcast: mockBroadcast } = await import("../ws.js");

function createApp() {
  const app = new Hono();
  app.route("/tasks", runRouter);
  return app;
}

function seedTask(taskId = "task-1", projectId = "proj-1") {
  testDb.current
    .insert(projects)
    .values({ id: projectId, name: "Test", rootPath: "/tmp/test" })
    .run();
  testDb.current.insert(tasks).values({ id: taskId, projectId, title: "Task" }).run();
}

describe("runRouter", () => {
  let app: Hono;

  beforeEach(() => {
    testDb.current = createTestDb();
    mockInternalBroadcastToken.value = "";
    vi.mocked(mockBroadcast).mockClear();
    seedTask();
    app = createApp();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("404s start for an unknown task", async () => {
    const res = await app.request("/tasks/missing-task/run/start", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("proxies start with the task's projectId and forwards the broker response", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: vi.fn().mockResolvedValue({ taskRunId: "run-1", taskId: "task-1", status: "running" }),
    } as unknown as Response);

    const res = await app.request("/tasks/task-1/run/start", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent:3013/run/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ taskRunId: "run-1", taskId: "task-1", status: "running" });
  });

  it("returns run_broker_unreachable (502) when the broker call fails", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await app.request("/tasks/task-1/run/start", { method: "POST" });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ error: "run_broker_unreachable" }),
    );
  });

  it("proxies stop with the resolved projectId", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, stopped: true }),
    } as unknown as Response);

    const res = await app.request("/tasks/task-1/run/stop", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent:3013/run/stop",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ projectId: "proj-1" }) }),
    );
    expect(res.status).toBe(200);
  });

  it("proxies status as a GET to the broker's per-project endpoint", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: vi.fn().mockResolvedValue({ active: false }),
    } as unknown as Response);

    const res = await app.request("/tasks/task-1/run/status");

    expect(fetchMock).toHaveBeenCalledWith("http://agent:3013/run/status/proj-1", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: false });
  });

  it("proxies inspect with taskId and projectId", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, spec: { type: "process" } }),
    } as unknown as Response);

    const res = await app.request("/tasks/task-1/run/inspect", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent:3013/run/inspect",
      expect.objectContaining({ body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }) }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a run:log broadcast without the internal broadcast token when auth is configured", async () => {
    mockInternalBroadcastToken.value = "internal-token";

    const res = await app.request("/tasks/task-1/run/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "run:log",
        payload: { taskId: "task-1", projectId: "proj-1", chunk: "hi\n" },
      }),
    });

    expect(res.status).toBe(401);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it("relays a run:log broadcast verbatim with a valid internal broadcast token", async () => {
    mockInternalBroadcastToken.value = "internal-token";

    const res = await app.request("/tasks/task-1/run/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Broadcast-Token": "internal-token",
      },
      body: JSON.stringify({
        type: "run:log",
        payload: { taskId: "task-1", projectId: "proj-1", chunk: "hello\n" },
      }),
    });

    expect(res.status).toBe(200);
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: "run:log",
      payload: { taskId: "task-1", projectId: "proj-1", chunk: "hello\n" },
    });
  });

  it("relays a run:status broadcast verbatim", async () => {
    mockInternalBroadcastToken.value = "internal-token";

    const res = await app.request("/tasks/task-1/run/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Broadcast-Token": "internal-token",
      },
      body: JSON.stringify({
        type: "run:status",
        payload: { taskId: "task-1", projectId: "proj-1", status: "exited", exitCode: 0 },
      }),
    });

    expect(res.status).toBe(200);
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: "run:status",
      payload: { taskId: "task-1", projectId: "proj-1", status: "exited", exitCode: 0 },
    });
  });
});
