import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MermaidDiagram } from "@/components/ui/mermaid-diagram";

const renderMock = vi.fn();
const initializeMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initializeMock(...args),
    render: (...args: unknown[]) => renderMock(...args),
  },
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

describe("MermaidDiagram", () => {
  beforeEach(() => {
    renderMock.mockReset();
    initializeMock.mockReset();
  });

  it("shows a loading placeholder before the diagram resolves", () => {
    renderMock.mockReturnValue(new Promise(() => {}));
    render(<MermaidDiagram code="graph TD; A-->B" />);
    expect(screen.getByLabelText("Rendering diagram")).toBeInTheDocument();
  });

  it("renders the resolved SVG once mermaid finishes", async () => {
    renderMock.mockResolvedValue({ svg: "<svg data-testid='mermaid-svg'></svg>" });
    const { container } = render(<MermaidDiagram code="graph TD; A-->B" />);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='mermaid-svg']")).toBeInTheDocument();
    });
    expect(initializeMock).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
  });

  it("falls back to raw code with an error message on invalid syntax", async () => {
    renderMock.mockRejectedValue(new Error("Parse error on line 1"));
    render(<MermaidDiagram code="not a real diagram" />);
    await waitFor(() => {
      expect(screen.getByText(/Mermaid diagram failed to render/)).toBeInTheDocument();
    });
    expect(screen.getByText("not a real diagram")).toBeInTheDocument();
  });
});
