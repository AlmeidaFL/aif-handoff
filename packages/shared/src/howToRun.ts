import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const HOW_TO_RUN_RELATIVE_PATH = ".ai-factory/HOW-TO-RUN.md";

export type HowToRunType = "process" | "docker";

export interface HowToRunSpec {
  type: HowToRunType;
  command: string;
  /** Required when type is "process" (needed to publish the port); unused for "docker". */
  port: number | null;
  notes: string | null;
}

export function getHowToRunPath(executionRoot: string): string {
  return resolve(executionRoot, HOW_TO_RUN_RELATIVE_PATH);
}

function extractSection(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n");
  const headingPattern = new RegExp(`^##\\s+${heading}\\s*$`, "i");
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (startIndex === -1) return null;

  const bodyLines: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    bodyLines.push(lines[i]);
  }
  return bodyLines.join("\n").trim();
}

function extractFencedCommand(section: string): string | null {
  const fenced = /```(?:[a-zA-Z0-9_-]*\n)?([\s\S]*?)```/.exec(section);
  const body = fenced ? fenced[1] : section;
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parses `.ai-factory/HOW-TO-RUN.md`. Returns `null` when the file doesn't
 * exist yet (the run-inspector agent hasn't bootstrapped it). Throws when
 * the file exists but is missing a required section — that's a corrupted
 * contract, not a "not yet generated" state, and callers should surface it
 * distinctly (e.g. prompt to re-inspect rather than silently bootstrapping).
 */
export function parseHowToRunFile(executionRoot: string): HowToRunSpec | null {
  const path = getHowToRunPath(executionRoot);
  if (!existsSync(path)) return null;

  const markdown = readFileSync(path, "utf8");

  const typeSection = extractSection(markdown, "Type");
  const type = typeSection?.trim().toLowerCase();
  if (type !== "process" && type !== "docker") {
    throw new Error(
      `${HOW_TO_RUN_RELATIVE_PATH} has an invalid or missing "## Type" section (expected "process" or "docker", got ${JSON.stringify(typeSection)})`,
    );
  }

  const commandSection = extractSection(markdown, "Command");
  const command = commandSection ? extractFencedCommand(commandSection) : null;
  if (!command) {
    throw new Error(`${HOW_TO_RUN_RELATIVE_PATH} is missing a "## Command" section with a command`);
  }

  let port: number | null = null;
  if (type === "process") {
    const portSection = extractSection(markdown, "Port");
    const parsedPort = portSection ? Number.parseInt(portSection.trim(), 10) : NaN;
    if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
      throw new Error(
        `${HOW_TO_RUN_RELATIVE_PATH} has type "process" but is missing a valid "## Port" section`,
      );
    }
    port = parsedPort;
  }

  const notes = extractSection(markdown, "Notes");

  return { type, command, port, notes: notes || null };
}
