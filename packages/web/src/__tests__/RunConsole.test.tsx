import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Task } from "@aif/shared/browser";

class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

const mockUseRunStatus = vi.fn();
const mockUseStartRun = vi.fn();
const mockUseStopRun = vi.fn();
const mockUseInspectRun = vi.fn();
const mockUseRunLog = vi.fn();

vi.mock("@/lib/api", () => ({ ApiError }));

vi.mock("@/hooks/useTaskRun", () => ({
  useRunStatus: (...args: unknown[]) => mockUseRunStatus(...args),
  useStartRun: () => mockUseStartRun(),
  useStopRun: () => mockUseStopRun(),
  useInspectRun: () => mockUseInspectRun(),
  useRunLog: (...args: unknown[]) => mockUseRunLog(...args),
}));

const { RunConsole } = await import("@/components/task/RunConsole");

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "proj-1",
    title: "Task",
    description: "",
    status: "review",
    priority: 0,
    autoMode: true,
    isFix: false,
    attachments: [],
    tags: [],
    plannerMode: "fast",
    planPath: ".ai-factory/PLAN.md",
    planDocs: false,
    planTests: false,
    skipReview: false,
    useSubagents: false,
    runPlanImprove: false,
    runPostVerify: false,
    autoQa: false,
    qaStatus: "idle",
    reworkRequested: false,
    reviewIterationCount: 0,
    maxReviewIterations: 3,
    manualReviewRequired: false,
    paused: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Task;
}

describe("RunConsole", () => {
  beforeEach(() => {
    mockUseRunStatus.mockReset();
    mockUseStartRun.mockReset();
    mockUseStopRun.mockReset();
    mockUseInspectRun.mockReset();
    mockUseRunLog.mockReset();

    mockUseRunStatus.mockReturnValue({ data: { active: false }, isLoading: false });
    mockUseStartRun.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
    mockUseStopRun.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseInspectRun.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    });
    mockUseRunLog.mockReturnValue({ lines: [], seed: vi.fn() });
  });

  it("shows a Run button and empty state when no run is active", () => {
    render(<RunConsole task={baseTask()} />);

    expect(screen.getByRole("button", { name: "Run" })).toBeDefined();
    expect(screen.getByText(/No output yet/)).toBeDefined();
  });

  it("shows a Stop button and the running command when a run is active", () => {
    mockUseRunStatus.mockReturnValue({
      data: {
        active: true,
        taskId: "task-1",
        projectId: "proj-1",
        command: "npm start",
        executionMode: "process",
        port: 4200,
        logTail: "",
      },
      isLoading: false,
    });

    render(<RunConsole task={baseTask()} />);

    expect(screen.getByRole("button", { name: /Stop/ })).toBeDefined();
    expect(screen.getByText("npm start")).toBeDefined();
    expect(screen.getByText(/port 4200/)).toBeDefined();
  });

  it("shows the how_to_run_missing prompt when start fails with that error", () => {
    mockUseStartRun.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new ApiError("Not Found", 404, { error: "how_to_run_missing" }),
    });

    render(<RunConsole task={baseTask()} />);

    expect(screen.getByText(/doesn't have run instructions yet/)).toBeDefined();
  });

  it("shows a generic error message for other start failures", () => {
    mockUseStartRun.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new ApiError("Broker unreachable", 502, {
        error: "run_broker_unreachable",
        message: "Broker unreachable",
      }),
    });

    render(<RunConsole task={baseTask()} />);

    expect(screen.getByText("Broker unreachable")).toBeDefined();
  });

  it("renders streamed log lines from useRunLog", () => {
    mockUseRunLog.mockReturnValue({ lines: ["compiling...\n", "done\n"], seed: vi.fn() });

    render(<RunConsole task={baseTask()} />);

    expect(screen.getByText(/compiling\.\.\..*done/s)).toBeDefined();
  });
});
