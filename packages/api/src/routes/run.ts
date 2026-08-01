import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getEnv, logger, type WsEvent } from "@aif/shared";
import { findTaskById } from "@aif/data";
import { internalBroadcastAuth } from "../middleware/internalBroadcastAuth.js";
import { jsonValidator } from "../middleware/zodValidator.js";
import { runBroadcastSchema } from "../schemas.js";
import { broadcast } from "../ws.js";

const log = logger("api:run");

export const runRouter = new Hono();

function brokerBaseUrl(): string {
  return getEnv().AGENT_RUN_INTERNAL_URL.replace(/\/$/, "");
}

async function proxy(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const target = `${brokerBaseUrl()}${path}`;
  log.debug({ method, target }, "[Run.proxy] forwarding");
  try {
    const res = await fetch(target, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data: unknown = await res.json().catch(() => ({}));
    log.debug({ status: res.status, target }, "[Run.proxy] response");
    return { status: res.status, body: data };
  } catch (err) {
    log.error({ err, target }, "[Run.proxy] run broker unreachable");
    return {
      status: 502,
      body: { error: "run_broker_unreachable", message: String(err) },
    };
  }
}

// POST /tasks/:id/run/start
runRouter.post("/:id/run/start", async (c) => {
  const { id } = c.req.param();
  const task = findTaskById(id);
  if (!task) return c.json({ error: "task_not_found" }, 404);

  const { status, body } = await proxy("POST", "/run/start", {
    taskId: id,
    projectId: task.projectId,
  });
  return c.json(body as object, status as ContentfulStatusCode);
});

// POST /tasks/:id/run/stop
runRouter.post("/:id/run/stop", async (c) => {
  const { id } = c.req.param();
  const task = findTaskById(id);
  if (!task) return c.json({ error: "task_not_found" }, 404);

  const { status, body } = await proxy("POST", "/run/stop", { projectId: task.projectId });
  return c.json(body as object, status as ContentfulStatusCode);
});

// GET /tasks/:id/run/status
runRouter.get("/:id/run/status", async (c) => {
  const { id } = c.req.param();
  const task = findTaskById(id);
  if (!task) return c.json({ error: "task_not_found" }, 404);

  const { status, body } = await proxy("GET", `/run/status/${task.projectId}`);
  return c.json(body as object, status as ContentfulStatusCode);
});

// POST /tasks/:id/run/inspect — bootstrap/refresh HOW-TO-RUN.md via the run-inspector agent
runRouter.post("/:id/run/inspect", async (c) => {
  const { id } = c.req.param();
  const task = findTaskById(id);
  if (!task) return c.json({ error: "task_not_found" }, 404);

  const { status, body } = await proxy("POST", "/run/inspect", {
    taskId: id,
    projectId: task.projectId,
  });
  return c.json(body as object, status as ContentfulStatusCode);
});

// POST /tasks/:id/run/broadcast — internal only, used by the agent's run broker
// to relay run:log/run:status WS events. Unlike /tasks/:id/broadcast, the
// payload is forwarded verbatim rather than re-derived from the task row.
runRouter.post(
  "/:id/run/broadcast",
  internalBroadcastAuth,
  jsonValidator(runBroadcastSchema),
  async (c) => {
    const { type, payload } = c.req.valid("json");
    broadcast({ type, payload } as WsEvent);
    log.debug({ taskId: c.req.param("id"), type }, "Run WS broadcast triggered");
    return c.json({ success: true });
  },
);
