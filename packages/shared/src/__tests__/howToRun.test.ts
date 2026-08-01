import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseHowToRunFile, getHowToRunPath, HOW_TO_RUN_RELATIVE_PATH } from "../howToRun.js";

function writeHowToRun(projectRoot: string, content: string): void {
  mkdirSync(join(projectRoot, ".ai-factory"), { recursive: true });
  writeFileSync(getHowToRunPath(projectRoot), content);
}

describe("parseHowToRunFile", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "how-to-run-test-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns null when the file does not exist", () => {
    expect(parseHowToRunFile(projectRoot)).toBeNull();
  });

  it("parses a valid process-type file", () => {
    writeHowToRun(
      projectRoot,
      [
        "# How to Run",
        "",
        "## Type",
        "process",
        "",
        "## Command",
        "```bash",
        "npm start",
        "```",
        "",
        "## Port",
        "4200",
        "",
        "## Notes",
        "Runs the Angular dev server.",
      ].join("\n"),
    );

    const spec = parseHowToRunFile(projectRoot);
    expect(spec).toEqual({
      type: "process",
      command: "npm start",
      port: 4200,
      notes: "Runs the Angular dev server.",
    });
  });

  it("parses a valid docker-type file without a port", () => {
    writeHowToRun(
      projectRoot,
      [
        "## Type",
        "docker",
        "",
        "## Command",
        "```bash",
        "docker compose -f Infra/docker/docker-compose.prod.yml up --build",
        "```",
      ].join("\n"),
    );

    const spec = parseHowToRunFile(projectRoot);
    expect(spec).toEqual({
      type: "docker",
      command: "docker compose -f Infra/docker/docker-compose.prod.yml up --build",
      port: null,
      notes: null,
    });
  });

  it("throws when the Type section is missing or invalid", () => {
    writeHowToRun(projectRoot, ["## Command", "```bash", "npm start", "```"].join("\n"));
    expect(() => parseHowToRunFile(projectRoot)).toThrow(/Type/);

    writeHowToRun(
      projectRoot,
      ["## Type", "vm", "## Command", "```bash", "npm start", "```"].join("\n"),
    );
    expect(() => parseHowToRunFile(projectRoot)).toThrow(/Type/);
  });

  it("throws when the Command section is missing or empty", () => {
    writeHowToRun(projectRoot, ["## Type", "docker"].join("\n"));
    expect(() => parseHowToRunFile(projectRoot)).toThrow(/Command/);

    writeHowToRun(projectRoot, ["## Type", "docker", "## Command", "```bash", "```"].join("\n"));
    expect(() => parseHowToRunFile(projectRoot)).toThrow(/Command/);
  });

  it("throws when type is process but Port is missing or invalid", () => {
    writeHowToRun(
      projectRoot,
      ["## Type", "process", "## Command", "```bash", "npm start", "```"].join("\n"),
    );
    expect(() => parseHowToRunFile(projectRoot)).toThrow(/Port/);

    writeHowToRun(
      projectRoot,
      [
        "## Type",
        "process",
        "## Command",
        "```bash",
        "npm start",
        "```",
        "## Port",
        "not-a-number",
      ].join("\n"),
    );
    expect(() => parseHowToRunFile(projectRoot)).toThrow(/Port/);
  });

  it("resolves the expected relative path", () => {
    expect(getHowToRunPath(projectRoot)).toBe(join(projectRoot, HOW_TO_RUN_RELATIVE_PATH));
  });
});
