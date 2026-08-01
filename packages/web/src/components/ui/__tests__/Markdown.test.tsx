import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "@/components/ui/markdown";

vi.mock("@/components/ui/mermaid-diagram", () => ({
  MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mermaid-diagram">{code}</div>,
}));

describe("Markdown", () => {
  it("renders a mermaid fenced code block via MermaidDiagram", () => {
    const content = "before\n\n```mermaid\ngraph TD;\nA-->B\n```\n\nafter";
    render(<Markdown content={content} />);
    const diagram = screen.getByTestId("mermaid-diagram");
    expect(diagram).toHaveTextContent("graph TD; A-->B");
  });

  it("renders a non-mermaid fenced code block as plain code", () => {
    const content = "```ts\nconst a = 1;\n```";
    render(<Markdown content={content} />);
    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument();
    expect(screen.getByText("const a = 1;")).toBeInTheDocument();
  });

  it("renders inline code without a language as plain code, not a diagram", () => {
    render(<Markdown content="use `npm install` to set up" />);
    expect(screen.queryByTestId("mermaid-diagram")).not.toBeInTheDocument();
    expect(screen.getByText("npm install")).toBeInTheDocument();
  });
});
