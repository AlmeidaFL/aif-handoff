import { useEffect, useId, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

interface MermaidDiagramProps {
  code: string;
  className?: string;
}

let renderCounter = 0;

/**
 * Renders a Mermaid diagram from raw diagram source. Falls back to the raw
 * code (plus an error message) on invalid syntax, since agent-generated
 * diagrams aren't guaranteed to be syntactically valid.
 */
type RenderResult =
  | { status: "loading"; forCode: string; forTheme: string }
  | { status: "success"; forCode: string; forTheme: string; svg: string }
  | { status: "error"; forCode: string; forTheme: string; message: string };

export function MermaidDiagram({ code, className }: MermaidDiagramProps) {
  const reactId = useId();
  const { theme } = useTheme();
  const [result, setResult] = useState<RenderResult>({
    status: "loading",
    forCode: code,
    forTheme: theme,
  });

  useEffect(() => {
    let cancelled = false;

    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === "dark" ? "dark" : "default",
          securityLevel: "strict",
        });
        const id = `mermaid-${reactId.replace(/[:]/g, "")}-${renderCounter++}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setResult({ status: "success", forCode: code, forTheme: theme, svg });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({
            status: "error",
            forCode: code,
            forTheme: theme,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, theme, reactId]);

  // Result belongs to a previous code/theme — treat as still loading rather
  // than flashing stale content. Derived at render time so no synchronous
  // setState is needed in the effect above.
  const isStale = result.forCode !== code || result.forTheme !== theme;
  const effective: RenderResult = isStale
    ? { status: "loading", forCode: code, forTheme: theme }
    : result;

  if (effective.status === "error") {
    return (
      <div className={cn("my-3 rounded border border-border", className)}>
        <div className="border-b border-border bg-secondary/45 px-3 py-1.5 text-xs text-muted-foreground">
          Mermaid diagram failed to render: {effective.message}
        </div>
        <pre className="overflow-x-auto p-3 text-[0.85em]">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (effective.status === "loading") {
    return (
      <div className={cn("my-3 rounded border border-border bg-secondary/25 p-3", className)}>
        <div
          className="h-24 animate-pulse rounded bg-secondary/45"
          aria-label="Rendering diagram"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "my-3 overflow-x-auto rounded border border-border bg-secondary/10 p-3",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: effective.svg }}
    />
  );
}
