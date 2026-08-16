import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChildProcess } from "node:child_process";

import { createRunBrokerRuntime, resolveRunCommand } from "../runBroker.js";
import type { HowToRunSpec } from "@aif/shared";

function createStubChild(): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess & EventEmitter;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (proc as unknown as { stdout: typeof stdout }).stdout = stdout;
  (proc as unknown as { stderr: typeof stderr }).stderr = stderr;
  (proc as unknown as { killed: boolean }).killed = false;
  (proc as unknown as { pid: number }).pid = 4242;
  (proc as unknown as { kill: (sig?: string) => boolean }).kill = vi.fn((_sig?: string) => {
    (proc as unknown as { killed: boolean }).killed = true;
    // Simulate the OS delivering the exit event shortly after the signal.
    queueMicrotask(() => proc.emit("exit", null, "SIGTERM"));
    return true;
  });
  return proc as ChildProcess;
}

function writeHowToRun(root: string, content: string): void {
  mkdirSync(join(root, ".ai-factory"), { recursive: true });
  writeFileSync(join(root, ".ai-factory", "HOW-TO-RUN.md"), content);
}

const PROCESS_SPEC_MD = [
  "## Type",
  "process",
  "## Command",
  "```bash",
  "npm start",
  "```",
  "## Port",
  "4200",
].join("\n");

function fakeDataLayer(overrides: { runDockerSocketEnabled?: boolean } = {}) {
  const taskRunRows: unknown[] = [];
  const statusUpdates: unknown[] = [];
  return {
    statusUpdates,
    layer: {
      findTaskById: vi.fn(() => ({
        id: "task-1",
        projectId: "proj-1",
        worktreePath: null,
      })) as unknown as typeof import("@aif/data").findTaskById,
      findProjectById: vi.fn(() => ({
        id: "proj-1",
        rootPath: "",
        runDockerSocketEnabled: overrides.runDockerSocketEnabled ?? false,
      })) as unknown as typeof import("@aif/data").findProjectById,
      createTaskRun: vi.fn((input: unknown) => {
        const row = {
          id: "run-1",
          startedAt: new Date().toISOString(),
          stoppedAt: null,
          ...(input as object),
        };
        taskRunRows.push(row);
        return row;
      }) as unknown as typeof import("@aif/data").createTaskRun,
      updateTaskRunStatus: vi.fn((id: string, patch: unknown) => {
        statusUpdates.push({ id, ...(patch as object) });
        return undefined;
      }) as unknown as typeof import("@aif/data").updateTaskRunStatus,
    },
  };
}

describe("resolveRunCommand", () => {
  const executionRoot = "/tmp/some-project";

  it("returns the docker command as-is when the socket is available", () => {
    const spec: HowToRunSpec = {
      type: "docker",
      command: "docker compose up --build",
      port: null,
      notes: null,
    };
    const result = resolveRunCommand(spec, { dockerSocketAvailable: true, executionRoot });
    expect(result).toEqual({ command: "docker compose up --build" });
  });

  it("errors for a docker command when the socket isn't available", () => {
    const spec: HowToRunSpec = {
      type: "docker",
      command: "docker compose up --build",
      port: null,
      notes: null,
    };
    const result = resolveRunCommand(spec, { dockerSocketAvailable: false, executionRoot });
    expect("error" in result && result.error).toMatch(/requires Docker/);
  });

  it("returns a raw process command unchanged when the socket isn't available", () => {
    const spec: HowToRunSpec = { type: "process", command: "npm start", port: 4200, notes: null };
    const result = resolveRunCommand(spec, { dockerSocketAvailable: false, executionRoot });
    expect(result).toEqual({ command: "npm start" });
  });

  it("errors for a process command when the socket is available but no wrapper image is configured", () => {
    const spec: HowToRunSpec = { type: "process", command: "npm start", port: 4200, notes: null };
    const result = resolveRunCommand(spec, { dockerSocketAvailable: true, executionRoot });
    expect("error" in result && result.error).toMatch(/AIF_RUN_WRAPPER_IMAGE/);
  });

  it("wraps a process command in docker run -p when the socket and wrapper image are available", () => {
    const spec: HowToRunSpec = { type: "process", command: "npm start", port: 4200, notes: null };
    const result = resolveRunCommand(spec, {
      dockerSocketAvailable: true,
      wrapperImage: "aif-handoff-agent",
      executionRoot,
    });
    expect("command" in result && result.command).toContain("docker run --rm -p 4200:4200");
    expect("command" in result && result.command).toContain("aif-handoff-agent");
    expect("command" in result && result.command).toContain("npm start");
  });
});

describe("runBroker HTTP surface", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "run-broker-test-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns how_to_run_missing when the project has no HOW-TO-RUN.md yet", async () => {
    const { layer } = fakeDataLayer();
    layer.findProjectById = vi.fn(() => ({
      id: "proj-1",
      rootPath: projectRoot,
      runDockerSocketEnabled: false,
    })) as unknown as typeof import("@aif/data").findProjectById;

    const runtime = createRunBrokerRuntime({ data: layer });
    const res = await runtime.app.request("/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: "how_to_run_missing" });
  });

  it("starts a process-type run, streams log chunks, and reaches running status", async () => {
    writeHowToRun(projectRoot, PROCESS_SPEC_MD);
    const { layer, statusUpdates } = fakeDataLayer();
    layer.findProjectById = vi.fn(() => ({
      id: "proj-1",
      rootPath: projectRoot,
      runDockerSocketEnabled: false,
    })) as unknown as typeof import("@aif/data").findProjectById;

    const stub = createStubChild();
    const onLog = vi.fn();
    const onStatus = vi.fn();
    const runtime = createRunBrokerRuntime({
      data: layer,
      spawnFn: vi.fn(() => stub) as unknown as typeof import("node:child_process").spawn,
      onLog,
      onStatus,
    });

    const res = await runtime.app.request("/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });
    expect(res.status).toBe(200);
    expect(layer.createTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({ command: "npm start", executionMode: "process", port: 4200 }),
    );
    expect(statusUpdates.at(-1)).toMatchObject({ status: "running" });
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));

    (stub as unknown as { stdout: EventEmitter }).stdout.emit(
      "data",
      Buffer.from("compiled successfully\n"),
    );
    expect(onLog).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        projectId: "proj-1",
        chunk: "compiled successfully\n",
      }),
    );

    expect(runtime.getActiveRun("proj-1")).toBeDefined();
  });

  it("rejects a second start for the same project while one is already active", async () => {
    writeHowToRun(projectRoot, PROCESS_SPEC_MD);
    const { layer } = fakeDataLayer();
    layer.findProjectById = vi.fn(() => ({
      id: "proj-1",
      rootPath: projectRoot,
      runDockerSocketEnabled: false,
    })) as unknown as typeof import("@aif/data").findProjectById;

    const runtime = createRunBrokerRuntime({
      data: layer,
      spawnFn: vi.fn(() =>
        createStubChild(),
      ) as unknown as typeof import("node:child_process").spawn,
    });

    await runtime.app.request("/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });
    const second = await runtime.app.request("/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });
    expect(second.status).toBe(409);
  });

  it("stop sends SIGTERM and transitions the run to stopped", async () => {
    writeHowToRun(projectRoot, PROCESS_SPEC_MD);
    const { layer, statusUpdates } = fakeDataLayer();
    layer.findProjectById = vi.fn(() => ({
      id: "proj-1",
      rootPath: projectRoot,
      runDockerSocketEnabled: false,
    })) as unknown as typeof import("@aif/data").findProjectById;

    const stub = createStubChild();
    const runtime = createRunBrokerRuntime({
      data: layer,
      spawnFn: vi.fn(() => stub) as unknown as typeof import("node:child_process").spawn,
    });

    await runtime.app.request("/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });

    const stopRes = await runtime.app.request("/run/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "proj-1" }),
    });
    expect(stopRes.status).toBe(200);
    expect((await stopRes.json()) as { stopped: boolean }).toMatchObject({ stopped: true });
    expect(stub.kill).toHaveBeenCalledWith("SIGTERM");

    // Let the queued microtask exit event flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(statusUpdates.at(-1)).toMatchObject({ status: "stopped" });
    expect(runtime.getActiveRun("proj-1")).toBeUndefined();
  });

  it("stop signals the whole process group, not just the direct child", async () => {
    // Commands run as `sh -c "<command>"`, and `sh` often forks the real work
    // (node, docker compose, ...) as a grandchild rather than exec-replacing
    // itself. Signaling only the direct child leaves that grandchild running
    // and orphaned. spawn() must be called with `detached: true` so the child
    // becomes its own process-group leader, and stop must target the group
    // via `process.kill(-pid, …)` so the whole tree is reached.
    writeHowToRun(projectRoot, PROCESS_SPEC_MD);
    const { layer } = fakeDataLayer();
    layer.findProjectById = vi.fn(() => ({
      id: "proj-1",
      rootPath: projectRoot,
      runDockerSocketEnabled: false,
    })) as unknown as typeof import("@aif/data").findProjectById;

    const stub = createStubChild();
    const spawnFn = vi.fn(() => stub) as unknown as typeof import("node:child_process").spawn;
    const runtime = createRunBrokerRuntime({ data: layer, spawnFn });

    await runtime.app.request("/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });

    expect(spawnFn).toHaveBeenCalledWith(
      "sh",
      expect.anything(),
      expect.objectContaining({ detached: true }),
    );

    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    await runtime.app.request("/run/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "proj-1" }),
    });

    expect(processKillSpy).toHaveBeenCalledWith(-(stub.pid as number), "SIGTERM");
    // Group-signal succeeded, so the direct-child fallback must not fire.
    expect(stub.kill).not.toHaveBeenCalled();
    processKillSpy.mockRestore();
  });

  it("falls back to signaling the direct child when process-group signaling fails", async () => {
    writeHowToRun(projectRoot, PROCESS_SPEC_MD);
    const { layer } = fakeDataLayer();
    layer.findProjectById = vi.fn(() => ({
      id: "proj-1",
      rootPath: projectRoot,
      runDockerSocketEnabled: false,
    })) as unknown as typeof import("@aif/data").findProjectById;

    const stub = createStubChild();
    const runtime = createRunBrokerRuntime({
      data: layer,
      spawnFn: vi.fn(() => stub) as unknown as typeof import("node:child_process").spawn,
    });

    await runtime.app.request("/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });

    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH: no such process group");
    });

    await runtime.app.request("/run/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "proj-1" }),
    });

    expect(processKillSpy).toHaveBeenCalledWith(-(stub.pid as number), "SIGTERM");
    expect(stub.kill).toHaveBeenCalledWith("SIGTERM");
    processKillSpy.mockRestore();
  });

  it("stop is a no-op when nothing is active for the project", async () => {
    const { layer } = fakeDataLayer();
    const runtime = createRunBrokerRuntime({ data: layer });
    const res = await runtime.app.request("/run/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "proj-1" }),
    });
    expect((await res.json()) as { stopped: boolean }).toEqual({ ok: true, stopped: false });
  });

  it("status reports active:false before a run starts and active:true with details after", async () => {
    writeHowToRun(projectRoot, PROCESS_SPEC_MD);
    const { layer } = fakeDataLayer();
    layer.findProjectById = vi.fn(() => ({
      id: "proj-1",
      rootPath: projectRoot,
      runDockerSocketEnabled: false,
    })) as unknown as typeof import("@aif/data").findProjectById;

    const runtime = createRunBrokerRuntime({
      data: layer,
      spawnFn: vi.fn(() =>
        createStubChild(),
      ) as unknown as typeof import("node:child_process").spawn,
    });

    const before = await runtime.app.request("/run/status/proj-1");
    expect((await before.json()) as { active: boolean }).toEqual({ active: false });

    await runtime.app.request("/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });

    const after = await runtime.app.request("/run/status/proj-1");
    const afterBody = (await after.json()) as { active: boolean; command: string; port: number };
    expect(afterBody.active).toBe(true);
    expect(afterBody.command).toBe("npm start");
    expect(afterBody.port).toBe(4200);
  });

  it("inspect delegates to inspectFn with the resolved execution root and returns the parsed spec", async () => {
    const { layer } = fakeDataLayer();
    layer.findProjectById = vi.fn(() => ({
      id: "proj-1",
      rootPath: projectRoot,
      runDockerSocketEnabled: false,
    })) as unknown as typeof import("@aif/data").findProjectById;

    const inspectFn = vi.fn(async () => {
      writeHowToRun(projectRoot, PROCESS_SPEC_MD);
    });
    const runtime = createRunBrokerRuntime({ data: layer, inspectFn });

    const res = await runtime.app.request("/run/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });

    expect(inspectFn).toHaveBeenCalledWith("task-1", projectRoot);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; spec: { command: string } };
    expect(body.ok).toBe(true);
    expect(body.spec.command).toBe("npm start");
  });

  it("inspect returns 500 when inspectFn throws", async () => {
    const { layer } = fakeDataLayer();
    layer.findProjectById = vi.fn(() => ({
      id: "proj-1",
      rootPath: projectRoot,
      runDockerSocketEnabled: false,
    })) as unknown as typeof import("@aif/data").findProjectById;

    const inspectFn = vi.fn(async () => {
      throw new Error("boom");
    });
    const runtime = createRunBrokerRuntime({ data: layer, inspectFn });

    const res = await runtime.app.request("/run/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
    });
    expect(res.status).toBe(500);
  });

  describe("HOW-TO-RUN.md root vs run-command root decoupling", () => {
    // HOW-TO-RUN.md is a project-level fact (which script, which port, docker
    // vs process) — it must always be (re)inspected and read at
    // project.rootPath, never at the task's own worktree, so every task
    // reuses one inspection per project instead of re-triggering the LLM
    // inspector per worktree. The run COMMAND itself must still execute in
    // the task's own worktree. These tests set worktreePath !== rootPath so
    // a regression collapsing the two roots back together would be caught.
    let worktreePath: string;

    beforeEach(() => {
      worktreePath = mkdtempSync(join(tmpdir(), "run-broker-worktree-"));
    });

    afterEach(() => {
      rmSync(worktreePath, { recursive: true, force: true });
    });

    it("/run/inspect calls inspectFn with project.rootPath, not task.worktreePath", async () => {
      const { layer } = fakeDataLayer();
      layer.findTaskById = vi.fn(() => ({
        id: "task-1",
        projectId: "proj-1",
        worktreePath,
      })) as unknown as typeof import("@aif/data").findTaskById;
      layer.findProjectById = vi.fn(() => ({
        id: "proj-1",
        rootPath: projectRoot,
        runDockerSocketEnabled: false,
      })) as unknown as typeof import("@aif/data").findProjectById;

      const inspectFn = vi.fn(async () => {
        writeHowToRun(projectRoot, PROCESS_SPEC_MD);
      });
      const runtime = createRunBrokerRuntime({ data: layer, inspectFn });

      const res = await runtime.app.request("/run/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
      });

      expect(res.status).toBe(200);
      // Inspected at the project root — never at the task worktree, even
      // though worktreePath is set and differs from rootPath.
      expect(inspectFn).toHaveBeenCalledWith("task-1", projectRoot);
      expect(inspectFn).not.toHaveBeenCalledWith("task-1", worktreePath);
    });

    it("/run/start reads HOW-TO-RUN.md from project.rootPath even when only the worktree exists on disk", async () => {
      // HOW-TO-RUN.md lives only at the project root; the task worktree has
      // no copy at all. If /run/start read at task.worktreePath this would
      // 404 with how_to_run_missing.
      writeHowToRun(projectRoot, PROCESS_SPEC_MD);
      const { layer } = fakeDataLayer();
      layer.findTaskById = vi.fn(() => ({
        id: "task-1",
        projectId: "proj-1",
        worktreePath,
      })) as unknown as typeof import("@aif/data").findTaskById;
      layer.findProjectById = vi.fn(() => ({
        id: "proj-1",
        rootPath: projectRoot,
        runDockerSocketEnabled: false,
      })) as unknown as typeof import("@aif/data").findProjectById;

      const runtime = createRunBrokerRuntime({
        data: layer,
        spawnFn: vi.fn(() =>
          createStubChild(),
        ) as unknown as typeof import("node:child_process").spawn,
      });

      const res = await runtime.app.request("/run/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
      });
      expect(res.status).toBe(200);
    });

    it("runs the resolved command with cwd at task.worktreePath, decoupled from the project-root HOW-TO-RUN.md read", async () => {
      // HOW-TO-RUN.md exists only at the project root (proves the spec was
      // read from rootPath), but the spawned process must still run with
      // cwd = task.worktreePath — proving the two roots are genuinely
      // independent within the same request, not just that one moved.
      writeHowToRun(projectRoot, PROCESS_SPEC_MD);
      const { layer } = fakeDataLayer();
      layer.findTaskById = vi.fn(() => ({
        id: "task-1",
        projectId: "proj-1",
        worktreePath,
      })) as unknown as typeof import("@aif/data").findTaskById;
      layer.findProjectById = vi.fn(() => ({
        id: "proj-1",
        rootPath: projectRoot,
        runDockerSocketEnabled: false,
      })) as unknown as typeof import("@aif/data").findProjectById;

      const spawnFn = vi.fn(() =>
        createStubChild(),
      ) as unknown as typeof import("node:child_process").spawn;
      const runtime = createRunBrokerRuntime({ data: layer, spawnFn });

      const res = await runtime.app.request("/run/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-1", projectId: "proj-1" }),
      });
      expect(res.status).toBe(200);

      expect(spawnFn).toHaveBeenCalledWith(
        "sh",
        expect.anything(),
        expect.objectContaining({ cwd: worktreePath }),
      );
      expect(spawnFn).not.toHaveBeenCalledWith(
        "sh",
        expect.anything(),
        expect.objectContaining({ cwd: projectRoot }),
      );
    });
  });
});
