import { findProjectById, findTaskById } from "@aif/data";
import { logger, parseHowToRunFile, HOW_TO_RUN_RELATIVE_PATH } from "@aif/shared";
import { executeSubagentQuery } from "../subagentQuery.js";

const log = logger("run-inspector");
const AGENT_NAME = "run-inspector";

/**
 * `.ai-factory/HOW-TO-RUN.md` contract — kept in one place and interpolated
 * into the prompt below so the inspector prompt and `parseHowToRunFile`
 * (packages/shared/src/howToRun.ts) never drift apart. See that file's
 * section-parsing logic for the exact rules (fixed `## Type`/`## Command`/
 * `## Port` headings, fenced command block, Port required only for "process").
 */
const CONTRACT_EXAMPLE = `# How to Run

## Type
process

## Command
\`\`\`bash
npm start
\`\`\`

## Port
4200

## Notes
Optional free-form notes.`;

/**
 * Runs the run-inspector's single-pass query: inspect the repo and write (or
 * refresh) \`${HOW_TO_RUN_RELATIVE_PATH}\`. No native agent definition — this
 * is a planChecker-style one-shot check, not a multi-turn pipeline stage.
 * Throws if the file still doesn't parse after the query completes, so the
 * caller can surface a clear failure instead of silently having nothing.
 */
export async function runRunInspector(taskId: string, executionRoot: string): Promise<void> {
  const task = findTaskById(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  const project = findProjectById(task.projectId);

  log.info({ taskId, executionRoot }, "Starting run-inspector");

  const prompt = `You are inspecting a software project to determine how to actually run it (start its dev server / app / stack), so an automated "Run" feature can execute it later without further LLM involvement.

Inspect the repository at ${executionRoot}: package.json scripts, Dockerfiles, docker-compose files, README, Makefile/Taskfile, launch configs, and any existing project documentation about running or deploying it (e.g. a CLAUDE.md "Running the App" section).

Write your findings to ${HOW_TO_RUN_RELATIVE_PATH} using EXACTLY this format (do not add extra top-level sections, do not rename the headings):

${CONTRACT_EXAMPLE}

Rules:
1) "## Type" must be exactly "process" (a single foreground command you run directly) or "docker" (a \`docker\` / \`docker compose\` invocation).
2) "## Command" must be a SINGLE foreground/blocking command — it must NOT detach (no \`-d\`, no \`&\`, no daemonizing). It needs to stay running in the foreground until stopped, so its output can be streamed live and it can be cleanly terminated with a signal.
3) If the project's own documented "how to run" command uses a detached/background flag (e.g. \`docker compose up -d\`), adapt it to the foreground equivalent (drop \`-d\`).
4) "## Port" is REQUIRED (and must be a single integer) when Type is "process". Omit it entirely when Type is "docker" (a docker/docker-compose command defines its own ports).
5) If the project has multiple runnable services (e.g. a docker-compose stack with several containers), prefer Type "docker" with the single command that starts the whole stack, rather than picking just one service.
6) Prefer a command that requires no interactive input.
7) Do not run the command yourself — only inspect the repository and write the file. You MAY do cheap availability checks (e.g. \`command -v python3\`) to confirm an interpreter/binary actually resolves in this shell before naming it in the Command — that is not "running" the app.
8) Verify the exact binary you name resolves in this environment, not just a common convention from the project's own docs/README. In particular, many Linux systems only have \`python3\` on PATH, not \`python\` — check with \`command -v python3\` / \`command -v python\` and use whichever actually resolves (same idea applies to e.g. \`node\` vs \`nodejs\`, \`pip3\` vs \`pip\`).
9) If you cannot confidently determine how to run this project, still write your best-effort guess and add a note under "## Notes" explaining the uncertainty — do not leave the file unwritten.`;

  const { resultText } = await executeSubagentQuery({
    taskId,
    projectRoot: executionRoot,
    agentName: AGENT_NAME,
    prompt,
    profileMode: "task",
    maxBudgetUsd: project?.implementerMaxBudgetUsd ?? null,
  });

  let spec;
  try {
    spec = parseHowToRunFile(executionRoot);
  } catch (err) {
    log.error({ taskId, err, resultText }, "run-inspector wrote an invalid HOW-TO-RUN.md");
    throw new Error(
      `run-inspector produced an invalid ${HOW_TO_RUN_RELATIVE_PATH}: ${String(err)}`,
    );
  }
  if (!spec) {
    log.error({ taskId, resultText }, "run-inspector did not write HOW-TO-RUN.md");
    throw new Error(`run-inspector did not write ${HOW_TO_RUN_RELATIVE_PATH}`);
  }

  log.info({ taskId, type: spec.type, port: spec.port }, "run-inspector finished");
}
