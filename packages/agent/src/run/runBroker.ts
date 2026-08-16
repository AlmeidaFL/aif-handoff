import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { spawn, type ChildProcess } from "node:child_process";
import { logger, parseHowToRunFile, type HowToRunSpec, type TaskRunStatus } from "@aif/shared";
import { findTaskById, findProjectById, createTaskRun, updateTaskRunStatus } from "@aif/data";
import { runRunInspector } from "./runInspector.js";

const log = logger("run-broker");

const DEFAULT_PORT = 3013;
const DEFAULT_HOST = "0.0.0.0";
/** Hard ceiling regardless of activity — safety net against orphaned processes. */
const DEFAULT_MAX_RUNTIME_MS = 6 * 60 * 60 * 1000;
/** Auto-stop after this long with no stdout/stderr output at all. */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/** Bounded tail kept in memory for reconnect/replay via /run/status. */
const LOG_BUFFER_MAX_CHARS = 200_000;

export interface RunLogEvent {
  taskId: string;
  projectId: string;
  chunk: string;
}

export interface RunStatusEvent {
  taskId: string;
  projectId: string;
  status: TaskRunStatus;
  exitCode: number | null;
  errorMessage: string | null;
}

export type RunLogSink = (event: RunLogEvent) => void;
export type RunStatusSink = (event: RunStatusEvent) => void;

interface DataLayer {
  findTaskById: typeof findTaskById;
  findProjectById: typeof findProjectById;
  createTaskRun: typeof createTaskRun;
  updateTaskRunStatus: typeof updateTaskRunStatus;
}

export interface RunBrokerOptions {
  port?: number;
  host?: string;
  spawnFn?: typeof spawn;
  onLog?: RunLogSink;
  onStatus?: RunStatusSink;
  maxRuntimeMs?: number;
  idleTimeoutMs?: number;
  /** Mirrors env.AIF_AGENT_DOCKER_SOCKET_ENABLED — the agent-side half of the opt-in. */
  dockerSocketEnabled?: boolean;
  /** Mirrors env.AIF_RUN_WRAPPER_IMAGE — required to wrap "process"-type commands. */
  wrapperImage?: string;
  data?: Partial<DataLayer>;
  /** Override for tests. */
  inspectFn?: typeof runRunInspector;
}

interface ActiveRun {
  taskRunId: string;
  taskId: string;
  projectId: string;
  command: string;
  executionMode: HowToRunSpec["type"];
  port: number | null;
  child: ChildProcess;
  runTimeoutTimer: NodeJS.Timeout | null;
  /** Set when the max-runtime safety net fires, so the exit handler can
   * report "stopped" instead of "error" for the resulting SIGKILL. */
  runTimedOut: boolean;
  idleTimer: NodeJS.Timeout | null;
  logBuffer: string;
  /** Set before we SIGTERM the child ourselves, so the exit handler can tell
   * an intentional stop apart from the process dying on its own. */
  stopRequested: boolean;
}

/**
 * Signals the child's entire process group, not just the direct child.
 *
 * Commands are spawned as `sh -c "<command>"`, and `sh` frequently forks the
 * real work (e.g. `node server.js`, `docker compose up`) as a grandchild
 * rather than exec-replacing itself. Killing only the direct child leaves
 * that grandchild running and orphaned (reparented to init) — the process
 * survives Stop and keeps its port bound. Spawning with `detached: true`
 * makes the child its own process-group leader, so `process.kill(-pid, …)`
 * reaches the whole tree. Falls back to a direct kill if group-signaling
 * isn't available (already dead, or unsupported on this platform).
 */
export function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.killed || child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // process already gone
    }
  }
}

interface BrokerContext {
  activeRuns: Map<string, ActiveRun>;
  data: DataLayer;
  options: {
    maxRuntimeMs: number;
    idleTimeoutMs: number;
    spawnFn: typeof spawn;
    dockerSocketEnabled: boolean;
    wrapperImage?: string;
    onLog?: RunLogSink;
    onStatus?: RunStatusSink;
    inspectFn: typeof runRunInspector;
  };
}

export interface RunBrokerRuntime {
  app: Hono;
  /** Internal accessor for tests */
  getActiveRun(projectId: string): Readonly<ActiveRun> | undefined;
  /** All currently active runs, across every project — used on process shutdown. */
  getActiveRuns(): ReadonlyArray<Readonly<ActiveRun>>;
}

export interface RunBrokerServer {
  runtime: RunBrokerRuntime;
  server: ServerType;
  port: number;
  host: string;
  close(): Promise<void>;
}

function appendToBuffer(buffer: string, chunk: string): string {
  const combined = buffer + chunk;
  return combined.length > LOG_BUFFER_MAX_CHARS
    ? combined.slice(combined.length - LOG_BUFFER_MAX_CHARS)
    : combined;
}

/**
 * Resolves the shell command to spawn, given the parsed HOW-TO-RUN.md spec
 * and whether Docker-socket execution is available for this project.
 *
 * - `docker` type always runs the command as-is; the agent's mounted socket
 *   (when enabled) makes it talk to the host's real Docker daemon, so any
 *   `docker compose`-defined ports publish normally — no wrapping needed.
 * - `process` type runs directly (bare-metal, or Docker-socket execution not
 *   enabled for this project — logs still work, host reachability isn't
 *   promised) or, when enabled, gets wrapped in `docker run -p <port>:<port>`
 *   using the agent's own image so toolchain parity with implement-coordinator
 *   is guaranteed.
 */
export function resolveRunCommand(
  spec: HowToRunSpec,
  input: { dockerSocketAvailable: boolean; wrapperImage?: string; executionRoot: string },
): { command: string } | { error: string } {
  if (spec.type === "docker") {
    if (!input.dockerSocketAvailable) {
      return {
        error:
          "This project's HOW-TO-RUN.md command requires Docker, but Docker-socket execution isn't enabled. Enable it for this project (and AIF_AGENT_DOCKER_SOCKET_ENABLED on the agent) first.",
      };
    }
    return { command: spec.command };
  }

  // process type
  if (!input.dockerSocketAvailable) {
    return { command: spec.command };
  }
  if (!input.wrapperImage) {
    return {
      error:
        "Docker-socket execution is enabled but AIF_RUN_WRAPPER_IMAGE isn't configured, so a raw process command can't be published to the host. Set AIF_RUN_WRAPPER_IMAGE (normally the agent's own image) or disable Docker-socket execution for this project.",
    };
  }
  const escapedCommand = spec.command.replace(/'/g, `'\\''`);
  return {
    command: `docker run --rm -p ${spec.port}:${spec.port} -v '${input.executionRoot}':/workspace -w /workspace ${input.wrapperImage} sh -c '${escapedCommand}'`,
  };
}

function clearIdleTimer(run: ActiveRun): void {
  if (run.idleTimer) {
    clearTimeout(run.idleTimer);
    run.idleTimer = null;
  }
}

function scheduleIdleTimer(ctx: BrokerContext, run: ActiveRun): void {
  clearIdleTimer(run);
  run.idleTimer = setTimeout(() => {
    log.warn(
      { taskId: run.taskId, projectId: run.projectId, idleTimeoutMs: ctx.options.idleTimeoutMs },
      "[RunBroker] idle timeout reached, stopping run",
    );
    stopActiveRun(ctx, run, "Stopped automatically after inactivity timeout");
  }, ctx.options.idleTimeoutMs);
  run.idleTimer.unref?.();
}

function recordStatus(
  ctx: BrokerContext,
  run: ActiveRun,
  status: TaskRunStatus,
  exitCode: number | null,
  errorMessage: string | null,
): void {
  ctx.data.updateTaskRunStatus(run.taskRunId, { status, exitCode, errorMessage });
  ctx.options.onStatus?.({
    taskId: run.taskId,
    projectId: run.projectId,
    status,
    exitCode,
    errorMessage,
  });
}

function stopActiveRun(ctx: BrokerContext, run: ActiveRun, reason?: string): void {
  run.stopRequested = true;
  clearIdleTimer(run);
  recordStatus(ctx, run, "stopping", null, reason ?? null);
  try {
    killProcessGroup(run.child, "SIGTERM");
  } catch (err) {
    log.warn({ err, taskId: run.taskId }, "[RunBroker] failed to signal child during stop");
  }
}

function createBrokerApp(ctx: BrokerContext): Hono {
  const app = new Hono();

  app.get("/run/status/:projectId", (c) => {
    const projectId = c.req.param("projectId");
    const run = ctx.activeRuns.get(projectId);
    if (!run) return c.json({ active: false });
    return c.json({
      active: true,
      taskId: run.taskId,
      projectId: run.projectId,
      command: run.command,
      executionMode: run.executionMode,
      port: run.port,
      logTail: run.logBuffer,
    });
  });

  app.post("/run/inspect", async (c) => {
    const body = await c.req
      .json<{ taskId?: string; projectId?: string }>()
      .catch(() => ({}) as { taskId?: string; projectId?: string });
    const { taskId, projectId } = body;
    if (!taskId || !projectId) {
      return c.json(
        { error: "invalid_request", message: "taskId and projectId are required" },
        400,
      );
    }

    const task = ctx.data.findTaskById(taskId);
    if (!task) return c.json({ error: "task_not_found" }, 404);
    const project = ctx.data.findProjectById(projectId);
    if (!project) return c.json({ error: "project_not_found" }, 404);

    const executionRoot = task.worktreePath ?? project.rootPath;

    try {
      await ctx.options.inspectFn(taskId, executionRoot);
    } catch (err) {
      log.error({ err, taskId, projectId }, "[RunBroker] run-inspector failed");
      return c.json({ error: "inspect_failed", message: String(err) }, 500);
    }

    const spec = parseHowToRunFile(executionRoot);
    return c.json({ ok: true, spec });
  });

  app.post("/run/start", async (c) => {
    const body = await c.req
      .json<{ taskId?: string; projectId?: string }>()
      .catch(() => ({}) as { taskId?: string; projectId?: string });
    const { taskId, projectId } = body;
    if (!taskId || !projectId) {
      return c.json(
        { error: "invalid_request", message: "taskId and projectId are required" },
        400,
      );
    }

    if (ctx.activeRuns.has(projectId)) {
      const existing = ctx.activeRuns.get(projectId)!;
      return c.json({ error: "run_already_active", taskId: existing.taskId, projectId }, 409);
    }

    const task = ctx.data.findTaskById(taskId);
    if (!task) return c.json({ error: "task_not_found" }, 404);
    const project = ctx.data.findProjectById(projectId);
    if (!project) return c.json({ error: "project_not_found" }, 404);

    const executionRoot = task.worktreePath ?? project.rootPath;

    let spec: HowToRunSpec | null;
    try {
      spec = parseHowToRunFile(executionRoot);
    } catch (err) {
      log.warn({ err, taskId, projectId }, "[RunBroker] HOW-TO-RUN.md is invalid");
      return c.json({ error: "how_to_run_invalid", message: String(err) }, 422);
    }
    if (!spec) {
      return c.json({ error: "how_to_run_missing" }, 404);
    }

    const dockerSocketAvailable = ctx.options.dockerSocketEnabled && project.runDockerSocketEnabled;
    const resolved = resolveRunCommand(spec, {
      dockerSocketAvailable,
      wrapperImage: ctx.options.wrapperImage,
      executionRoot,
    });
    if ("error" in resolved) {
      return c.json({ error: "run_command_unavailable", message: resolved.error }, 422);
    }

    const taskRunRow = ctx.data.createTaskRun({
      taskId,
      projectId,
      command: resolved.command,
      executionMode: spec.type,
      port: spec.port,
    });

    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (spec.type === "process" && spec.port) {
      // Override any ambient PORT the agent process itself inherited (e.g. the
      // API's own PORT in a bare-metal deploy sharing one shell environment)
      // so the child binds to the port declared in HOW-TO-RUN.md, not a stray one.
      childEnv.PORT = String(spec.port);
    }

    let child: ChildProcess;
    try {
      child = ctx.options.spawnFn("sh", ["-c", resolved.command], {
        cwd: executionRoot,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
        // Own process-group leader so killProcessGroup() can reach grandchildren
        // spawned by `sh` (e.g. `node`, `docker compose`), not just `sh` itself.
        detached: true,
      });
    } catch (err) {
      log.error({ err, taskId, projectId }, "[RunBroker] spawn failed");
      ctx.data.updateTaskRunStatus(taskRunRow.id, {
        status: "error",
        errorMessage: `Failed to start: ${String(err)}`,
      });
      return c.json({ error: "spawn_failed", message: String(err) }, 500);
    }

    const run: ActiveRun = {
      taskRunId: taskRunRow.id,
      taskId,
      projectId,
      command: resolved.command,
      executionMode: spec.type,
      port: spec.port,
      child,
      runTimeoutTimer: null,
      runTimedOut: false,
      idleTimer: null,
      logBuffer: "",
      stopRequested: false,
    };

    if (ctx.options.maxRuntimeMs > 0) {
      run.runTimeoutTimer = setTimeout(() => {
        run.runTimeoutTimer = null;
        run.runTimedOut = true;
        log.warn(
          { taskId, projectId, maxRuntimeMs: ctx.options.maxRuntimeMs },
          "[RunBroker] max runtime exceeded, killing process",
        );
        killProcessGroup(child, "SIGKILL");
      }, ctx.options.maxRuntimeMs);
      run.runTimeoutTimer.unref?.();
    }

    ctx.activeRuns.set(projectId, run);
    scheduleIdleTimer(ctx, run);

    const onOutput = (data: Buffer) => {
      const text = data.toString("utf8");
      run.logBuffer = appendToBuffer(run.logBuffer, text);
      scheduleIdleTimer(ctx, run);
      ctx.options.onLog?.({ taskId, projectId, chunk: text });
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);

    child.once("exit", (code, signal) => {
      clearIdleTimer(run);
      if (run.runTimeoutTimer) {
        clearTimeout(run.runTimeoutTimer);
        run.runTimeoutTimer = null;
      }
      ctx.activeRuns.delete(projectId);

      if (run.stopRequested) {
        recordStatus(ctx, run, "stopped", code, null);
      } else if (run.runTimedOut) {
        recordStatus(ctx, run, "stopped", code, "Stopped automatically after max runtime exceeded");
      } else if (code === 0 && !signal) {
        recordStatus(ctx, run, "exited", code, null);
      } else {
        recordStatus(
          ctx,
          run,
          "error",
          code,
          signal ? `Process terminated by signal ${signal}` : `Process exited with code ${code}`,
        );
      }
    });

    child.once("error", (err) => {
      clearIdleTimer(run);
      if (run.runTimeoutTimer) {
        clearTimeout(run.runTimeoutTimer);
        run.runTimeoutTimer = null;
      }
      ctx.activeRuns.delete(projectId);
      recordStatus(ctx, run, "error", null, String(err));
    });

    recordStatus(ctx, run, "running", null, null);
    log.info(
      { taskId, projectId, executionMode: spec.type, dockerSocketAvailable },
      "[RunBroker] run started",
    );
    return c.json({ taskRunId: taskRunRow.id, taskId, projectId, status: "running" });
  });

  app.post("/run/stop", async (c) => {
    const body = await c.req
      .json<{ projectId?: string }>()
      .catch(() => ({}) as { projectId?: string });
    const projectId = body.projectId;
    if (!projectId)
      return c.json({ error: "invalid_request", message: "projectId is required" }, 400);

    const run = ctx.activeRuns.get(projectId);
    if (!run) return c.json({ ok: true, stopped: false });

    stopActiveRun(ctx, run);
    return c.json({ ok: true, stopped: true, taskId: run.taskId });
  });

  return app;
}

export function createRunBrokerRuntime(options: RunBrokerOptions = {}): RunBrokerRuntime {
  const ctx: BrokerContext = {
    activeRuns: new Map(),
    data: {
      findTaskById: options.data?.findTaskById ?? findTaskById,
      findProjectById: options.data?.findProjectById ?? findProjectById,
      createTaskRun: options.data?.createTaskRun ?? createTaskRun,
      updateTaskRunStatus: options.data?.updateTaskRunStatus ?? updateTaskRunStatus,
    },
    options: {
      maxRuntimeMs: options.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS,
      idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      spawnFn: options.spawnFn ?? spawn,
      dockerSocketEnabled: options.dockerSocketEnabled ?? false,
      wrapperImage: options.wrapperImage,
      onLog: options.onLog,
      onStatus: options.onStatus,
      inspectFn: options.inspectFn ?? runRunInspector,
    },
  };

  const app = createBrokerApp(ctx);
  return {
    app,
    getActiveRun: (projectId: string) => ctx.activeRuns.get(projectId),
    getActiveRuns: () => Array.from(ctx.activeRuns.values()),
  };
}

export async function startRunBroker(options: RunBrokerOptions = {}): Promise<RunBrokerServer> {
  const runtime = createRunBrokerRuntime(options);
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;

  const server = serve({ fetch: runtime.app.fetch, port, hostname: host });
  log.info({ host, port }, "[RunBroker] listening");

  return {
    runtime,
    server,
    port,
    host,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
