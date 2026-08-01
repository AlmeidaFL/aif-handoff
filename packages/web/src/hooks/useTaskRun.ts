import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskRunLogPayload } from "@aif/shared/browser";
import { api } from "@/lib/api";

export function useRunStatus(taskId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["taskRunStatus", taskId],
    queryFn: () => api.getRunStatus(taskId!),
    enabled: Boolean(taskId) && enabled,
    staleTime: 5_000,
  });
}

export function useStartRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.startRun(taskId),
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: ["taskRunStatus", taskId] });
    },
  });
}

export function useStopRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.stopRun(taskId),
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: ["taskRunStatus", taskId] });
    },
  });
}

export function useInspectRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.inspectRun(taskId),
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: ["taskRunStatus", taskId] });
    },
  });
}

/**
 * Live log lines for a task's active Run, fed by the `run:log` WS event
 * (bypasses react-query — see useWebSocket.ts). `seed` re-primes the buffer
 * (e.g. from the broker's buffered tail on reconnect) without being
 * overwritten by later live chunks.
 */
export function useRunLog(taskId: string | null) {
  const [lines, setLines] = useState<string[]>([]);

  // Reset the buffer when taskId changes — done during render (React's
  // documented "adjusting state when a prop changes" pattern), not inside
  // the effect below, to avoid an extra synchronous-setState-in-effect render.
  const [seenTaskId, setSeenTaskId] = useState(taskId);
  if (taskId !== seenTaskId) {
    setSeenTaskId(taskId);
    setLines([]);
  }

  useEffect(() => {
    if (!taskId) return;

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TaskRunLogPayload>).detail;
      if (!detail || detail.taskId !== taskId) return;
      setLines((prev) => [...prev, detail.chunk]);
    };
    window.addEventListener("run:log", handler);
    return () => window.removeEventListener("run:log", handler);
  }, [taskId]);

  const seed = (tail: string) => {
    if (tail) setLines([tail]);
  };

  return { lines, seed };
}
