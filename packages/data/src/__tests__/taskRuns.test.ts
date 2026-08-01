import { describe, it, expect, beforeEach, vi } from "vitest";
import { projects, tasks } from "@aif/shared";
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
  createTaskRun,
  updateTaskRunStatus,
  getActiveTaskRunForProject,
  getLatestTaskRunForTask,
  toTaskRunResponse,
} = dataModule;

function seedProjectAndTask(projectId = "proj-1", taskId = "task-1") {
  testDb.current.insert(projects).values({ id: projectId, name: "Test", rootPath: "/tmp/test" }).run();
  testDb.current.insert(tasks).values({ id: taskId, projectId, title: "Task" }).run();
}

describe("task runs data layer", () => {
  beforeEach(() => {
    testDb.current = createTestDb();
    seedProjectAndTask();
  });

  it("returns undefined when no active run exists for a project", () => {
    expect(getActiveTaskRunForProject("proj-1")).toBeUndefined();
  });

  it("creates a run with status starting", () => {
    const row = createTaskRun({
      taskId: "task-1",
      projectId: "proj-1",
      command: "npm start",
      executionMode: "process",
      port: 4200,
    });

    expect(row.status).toBe("starting");
    expect(row.command).toBe("npm start");
    expect(row.executionMode).toBe("process");
    expect(row.port).toBe(4200);
    expect(row.stoppedAt).toBeNull();
  });

  it("a docker-type run has no port", () => {
    const row = createTaskRun({
      taskId: "task-1",
      projectId: "proj-1",
      command: "docker compose up --build",
      executionMode: "docker",
    });

    expect(row.executionMode).toBe("docker");
    expect(row.port).toBeNull();
  });

  it("surfaces the created run as the active run for its project", () => {
    const created = createTaskRun({
      taskId: "task-1",
      projectId: "proj-1",
      command: "npm start",
      executionMode: "process",
      port: 4200,
    });

    const active = getActiveTaskRunForProject("proj-1");
    expect(active?.id).toBe(created.id);
  });

  it("stops being the active run once its status is terminal", () => {
    const created = createTaskRun({
      taskId: "task-1",
      projectId: "proj-1",
      command: "npm start",
      executionMode: "process",
      port: 4200,
    });

    updateTaskRunStatus(created.id, { status: "exited", exitCode: 0 });

    expect(getActiveTaskRunForProject("proj-1")).toBeUndefined();
  });

  it("updateTaskRunStatus records exit code, error message, and stoppedAt on terminal status", () => {
    const created = createTaskRun({
      taskId: "task-1",
      projectId: "proj-1",
      command: "npm start",
      executionMode: "process",
      port: 4200,
    });

    const updated = updateTaskRunStatus(created.id, {
      status: "error",
      errorMessage: "Command not found",
    });

    expect(updated?.status).toBe("error");
    expect(updated?.errorMessage).toBe("Command not found");
    expect(updated?.stoppedAt).not.toBeNull();
  });

  it("does not set stoppedAt for a non-terminal status transition", () => {
    const created = createTaskRun({
      taskId: "task-1",
      projectId: "proj-1",
      command: "npm start",
      executionMode: "process",
      port: 4200,
    });

    const updated = updateTaskRunStatus(created.id, { status: "running" });

    expect(updated?.status).toBe("running");
    expect(updated?.stoppedAt).toBeNull();
  });

  it("getLatestTaskRunForTask returns the most recently started run", () => {
    createTaskRun({
      taskId: "task-1",
      projectId: "proj-1",
      command: "npm start",
      executionMode: "process",
      port: 4200,
    });
    updateTaskRunStatus(getActiveTaskRunForProject("proj-1")!.id, { status: "exited", exitCode: 0 });

    const second = createTaskRun({
      taskId: "task-1",
      projectId: "proj-1",
      command: "npm run dev",
      executionMode: "process",
      port: 4201,
    });

    const latest = getLatestTaskRunForTask("task-1");
    expect(latest?.id).toBe(second.id);
  });

  it("toTaskRunResponse maps a raw row to its response shape", () => {
    const row = createTaskRun({
      taskId: "task-1",
      projectId: "proj-1",
      command: "npm start",
      executionMode: "process",
      port: 4200,
    });

    expect(toTaskRunResponse(row)).toEqual({
      id: row.id,
      taskId: "task-1",
      projectId: "proj-1",
      status: "starting",
      command: "npm start",
      executionMode: "process",
      port: 4200,
      exitCode: null,
      errorMessage: null,
      startedAt: row.startedAt,
      stoppedAt: null,
    });
  });
});
