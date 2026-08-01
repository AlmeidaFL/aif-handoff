import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { projects, tasks } from "@aif/shared";
import { createTestDb } from "@aif/shared/server";

const testDb = { current: createTestDb() };
const queryMock = vi.fn();
(globalThis as { __AIF_CLAUDE_QUERY_MOCK__?: typeof queryMock }).__AIF_CLAUDE_QUERY_MOCK__ =
  queryMock;

vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

const { runRunInspector } = await import("../runInspector.js");

function streamSuccess(result: string): AsyncIterable<{
  type: "result";
  subtype: "success";
  result: string;
}> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "result", subtype: "success", result };
    },
  };
}

const VALID_HOW_TO_RUN = [
  "## Type",
  "process",
  "## Command",
  "```bash",
  "npm start",
  "```",
  "## Port",
  "4200",
].join("\n");

describe("runRunInspector", () => {
  let executionRoot: string;

  beforeEach(() => {
    (globalThis as { __AIF_CLAUDE_QUERY_MOCK__?: typeof queryMock }).__AIF_CLAUDE_QUERY_MOCK__ =
      queryMock;
    testDb.current = createTestDb();
    queryMock.mockReset();
    executionRoot = mkdtempSync(join(tmpdir(), "run-inspector-test-"));

    testDb.current
      .insert(projects)
      .values({ id: "project-1", name: "Test", rootPath: executionRoot })
      .run();
    testDb.current
      .insert(tasks)
      .values({ id: "task-1", projectId: "project-1", title: "Task", status: "review" })
      .run();
  });

  afterEach(() => {
    rmSync(executionRoot, { recursive: true, force: true });
  });

  it("resolves once the agent has written a valid HOW-TO-RUN.md", async () => {
    queryMock.mockImplementation(() => {
      mkdirSync(join(executionRoot, ".ai-factory"), { recursive: true });
      writeFileSync(join(executionRoot, ".ai-factory", "HOW-TO-RUN.md"), VALID_HOW_TO_RUN);
      return streamSuccess("Wrote .ai-factory/HOW-TO-RUN.md");
    });

    await expect(runRunInspector("task-1", executionRoot)).resolves.toBeUndefined();
  });

  it("throws when the agent never writes the file", async () => {
    queryMock.mockReturnValue(streamSuccess("I looked around but did not write anything."));

    await expect(runRunInspector("task-1", executionRoot)).rejects.toThrow(/did not write/);
  });

  it("throws when the agent writes an invalid HOW-TO-RUN.md", async () => {
    queryMock.mockImplementation(() => {
      mkdirSync(join(executionRoot, ".ai-factory"), { recursive: true });
      writeFileSync(join(executionRoot, ".ai-factory", "HOW-TO-RUN.md"), "not the right format");
      return streamSuccess("Wrote it");
    });

    await expect(runRunInspector("task-1", executionRoot)).rejects.toThrow(/invalid/);
  });

  it("throws when the task does not exist", async () => {
    await expect(runRunInspector("missing-task", executionRoot)).rejects.toThrow(/not found/);
  });
});
