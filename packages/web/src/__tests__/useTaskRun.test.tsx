import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

const mockStartRun = vi.fn();
const mockStopRun = vi.fn();
const mockInspectRun = vi.fn();
const mockGetRunStatus = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    startRun: (...args: unknown[]) => mockStartRun(...args),
    stopRun: (...args: unknown[]) => mockStopRun(...args),
    inspectRun: (...args: unknown[]) => mockInspectRun(...args),
    getRunStatus: (...args: unknown[]) => mockGetRunStatus(...args),
  },
}));

const { useRunStatus, useStartRun, useStopRun, useInspectRun, useRunLog } =
  await import("@/hooks/useTaskRun");

function createWrapper(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useTaskRun", () => {
  beforeEach(() => {
    mockStartRun.mockReset();
    mockStopRun.mockReset();
    mockInspectRun.mockReset();
    mockGetRunStatus.mockReset();
  });

  it("useRunStatus fetches the current run status for a task", async () => {
    mockGetRunStatus.mockResolvedValue({ active: false });

    const { result } = renderHook(() => useRunStatus("task-1"), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetRunStatus).toHaveBeenCalledWith("task-1");
    expect(result.current.data).toEqual({ active: false });
  });

  it("useStartRun calls api.startRun and invalidates the status query on success", async () => {
    mockStartRun.mockResolvedValue({ taskRunId: "run-1", taskId: "task-1", status: "running" });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useStartRun(), { wrapper: createWrapper(queryClient) });
    await act(async () => {
      await result.current.mutateAsync("task-1");
    });

    expect(mockStartRun).toHaveBeenCalledWith("task-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["taskRunStatus", "task-1"] });
  });

  it("useStopRun calls api.stopRun and invalidates the status query on success", async () => {
    mockStopRun.mockResolvedValue({ ok: true, stopped: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useStopRun(), { wrapper: createWrapper(queryClient) });
    await act(async () => {
      await result.current.mutateAsync("task-1");
    });

    expect(mockStopRun).toHaveBeenCalledWith("task-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["taskRunStatus", "task-1"] });
  });

  it("useInspectRun calls api.inspectRun", async () => {
    mockInspectRun.mockResolvedValue({
      ok: true,
      spec: { type: "process", command: "npm start", port: 4200, notes: null },
    });

    const { result } = renderHook(() => useInspectRun(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync("task-1");
    });

    expect(mockInspectRun).toHaveBeenCalledWith("task-1");
  });
});

describe("useRunLog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends chunks from run:log events matching the given taskId", () => {
    const { result } = renderHook(() => useRunLog("task-1"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("run:log", {
          detail: { taskId: "task-1", projectId: "proj-1", chunk: "hello\n" },
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("run:log", {
          detail: { taskId: "task-1", projectId: "proj-1", chunk: "world\n" },
        }),
      );
    });

    expect(result.current.lines).toEqual(["hello\n", "world\n"]);
  });

  it("ignores run:log events for a different taskId", () => {
    const { result } = renderHook(() => useRunLog("task-1"));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("run:log", {
          detail: { taskId: "task-2", projectId: "proj-1", chunk: "not for me\n" },
        }),
      );
    });

    expect(result.current.lines).toEqual([]);
  });

  it("resets its buffer when the taskId changes", () => {
    const { result, rerender } = renderHook(({ taskId }) => useRunLog(taskId), {
      initialProps: { taskId: "task-1" as string | null },
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("run:log", {
          detail: { taskId: "task-1", projectId: "proj-1", chunk: "first\n" },
        }),
      );
    });
    expect(result.current.lines).toEqual(["first\n"]);

    rerender({ taskId: "task-2" });
    expect(result.current.lines).toEqual([]);
  });

  it("seed replaces the buffer with the given tail", () => {
    const { result } = renderHook(() => useRunLog("task-1"));

    act(() => {
      result.current.seed("buffered tail\n");
    });

    expect(result.current.lines).toEqual(["buffered tail\n"]);
  });
});
