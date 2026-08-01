import { useEffect, useRef } from "react";
import type { Task } from "@aif/shared/browser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AlertBox } from "@/components/ui/alert-box";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError } from "@/lib/api";
import {
  useRunStatus,
  useStartRun,
  useStopRun,
  useInspectRun,
  useRunLog,
} from "@/hooks/useTaskRun";

interface RunConsoleProps {
  task: Task;
}

const STATUS_VARIANT: Record<string, "outline" | "secondary" | "default" | "error"> = {
  starting: "secondary",
  running: "default",
  stopping: "secondary",
  stopped: "outline",
  exited: "outline",
  error: "error",
};

export function RunConsole({ task }: RunConsoleProps) {
  const { data: statusData, isLoading: statusLoading } = useRunStatus(task.id);
  const startRun = useStartRun();
  const stopRun = useStopRun();
  const inspectRun = useInspectRun();
  const runLog = useRunLog(task.id);
  const consoleRef = useRef<HTMLDivElement>(null);
  const seededForRunRef = useRef<string | null>(null);

  const active = statusData?.active === true;

  // Seed the console from the broker's buffered tail once per run (page
  // refresh / reconnect mid-run) — never re-seed on subsequent status polls,
  // since live chunks from run:log already own the buffer after that.
  useEffect(() => {
    if (active && statusData.active) {
      const seedKey = `${task.id}:${statusData.command}:${statusData.port ?? ""}`;
      if (seededForRunRef.current !== seedKey) {
        seededForRunRef.current = seedKey;
        runLog.seed(statusData.logTail);
      }
    } else {
      seededForRunRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, statusData]);

  useEffect(() => {
    const el = consoleRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [runLog.lines]);

  const howToRunMissing =
    startRun.isError &&
    startRun.error instanceof ApiError &&
    (startRun.error.data as { error?: string } | undefined)?.error === "how_to_run_missing";

  const startErrorMessage =
    startRun.isError && !howToRunMissing
      ? startRun.error instanceof ApiError
        ? ((startRun.error.data as { message?: string } | undefined)?.message ??
          startRun.error.message)
        : String(startRun.error)
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-background/55 p-3">
        <div className="flex items-center gap-2">
          {active ? (
            <Button
              size="xs"
              variant="destructive"
              onClick={() => stopRun.mutate(task.id)}
              disabled={stopRun.isPending}
              className="gap-1.5"
            >
              {stopRun.isPending ? (
                <>
                  <Spinner size="sm" /> Stopping…
                </>
              ) : (
                "Stop"
              )}
            </Button>
          ) : (
            <Button
              size="xs"
              onClick={() => startRun.mutate(task.id)}
              disabled={startRun.isPending || statusLoading}
              className="gap-1.5"
            >
              {startRun.isPending ? (
                <>
                  <Spinner size="sm" /> Starting…
                </>
              ) : (
                "Run"
              )}
            </Button>
          )}
          <Button
            size="xs"
            variant="outline"
            onClick={() => inspectRun.mutate(task.id)}
            disabled={inspectRun.isPending || active}
          >
            {inspectRun.isPending ? "Inspecting…" : "Re-inspect"}
          </Button>
        </div>
        {active && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Badge size="sm" variant={STATUS_VARIANT.running}>
              RUNNING
            </Badge>
            <span className="font-mono">{statusData.command}</span>
            {statusData.port && <span>· port {statusData.port}</span>}
          </div>
        )}
      </div>

      {howToRunMissing && (
        <AlertBox variant="warning" className="text-xs">
          This project doesn't have run instructions yet ({"`.ai-factory/HOW-TO-RUN.md`"} is
          missing). Click "Re-inspect" to have an agent figure out how to run it, then try Run
          again.
        </AlertBox>
      )}
      {startErrorMessage && (
        <AlertBox variant="error" className="text-xs">
          {startErrorMessage}
        </AlertBox>
      )}
      {inspectRun.isError && (
        <AlertBox variant="error" className="text-xs">
          Inspection failed:{" "}
          {inspectRun.error instanceof ApiError
            ? inspectRun.error.message
            : String(inspectRun.error)}
        </AlertBox>
      )}
      {inspectRun.isSuccess && (
        <AlertBox variant="success" className="text-xs">
          Wrote {"`.ai-factory/HOW-TO-RUN.md`"} — type: {inspectRun.data.spec.type}, command:{" "}
          <span className="font-mono">{inspectRun.data.spec.command}</span>
          {inspectRun.data.spec.port ? ` (port ${inspectRun.data.spec.port})` : ""}.
        </AlertBox>
      )}

      <div
        ref={consoleRef}
        className="h-64 overflow-y-auto border border-border bg-black/90 p-3 font-mono text-[11px] leading-5 text-green-400"
      >
        {runLog.lines.length === 0 ? (
          <EmptyState message={active ? "Waiting for output…" : "No output yet — click Run"} />
        ) : (
          <pre className="whitespace-pre-wrap break-all">{runLog.lines.join("")}</pre>
        )}
      </div>
    </div>
  );
}
