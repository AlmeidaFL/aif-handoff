import { useMemo, useState } from "react";
import { AGENT_CATALOG, type CustomizableAgentRole } from "@aif/shared/browser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useAgentCustomizations,
  useUpsertAgentCustomization,
} from "@/hooks/useAgentCustomizations";

const STAGE_LABELS: Record<(typeof AGENT_CATALOG)[number]["stage"], string> = {
  planning: "Planning",
  implementing: "Implementing",
  review: "Review",
};

interface RowProps {
  projectId: string;
  role: CustomizableAgentRole;
  label: string;
  stage: string;
  description: string;
  limitations: string;
  savedInstructions: string;
}

function CustomizableAgentRow({
  projectId,
  role,
  label,
  stage,
  description,
  limitations,
  savedInstructions,
}: RowProps) {
  const [draft, setDraft] = useState(savedInstructions);
  const [prevSavedInstructions, setPrevSavedInstructions] = useState(savedInstructions);
  const upsert = useUpsertAgentCustomization();

  if (savedInstructions !== prevSavedInstructions) {
    setPrevSavedInstructions(savedInstructions);
    setDraft(savedInstructions);
  }

  const dirty = draft !== savedInstructions;

  return (
    <div className="space-y-2 rounded border border-border bg-background/40 px-2 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge size="sm" variant="outline">
          {stage}
        </Badge>
        <Badge size="sm" variant="agent">
          {label}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">{description}</p>
      <p className="text-[11px] text-muted-foreground">Limitations: {limitations}</p>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Extra project-specific instructions for this agent (optional)..."
        rows={3}
        className="text-xs"
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            void upsert.mutateAsync({ projectId, agentRole: role, customInstructions: draft })
          }
          disabled={!dirty || upsert.isPending}
        >
          {upsert.isPending ? "Saving..." : "Save"}
        </Button>
        {upsert.isError && (
          <span className="text-[11px] text-red-500">
            {upsert.error instanceof Error ? upsert.error.message : "Failed to save"}
          </span>
        )}
      </div>
    </div>
  );
}

interface Props {
  projectId: string;
  enabled: boolean;
}

export function AgentInstructionsSection({ projectId, enabled }: Props) {
  const { data: customizations = [], isLoading } = useAgentCustomizations(projectId, enabled);
  const savedByRole = useMemo(() => {
    const map = new Map<string, string>();
    for (const customization of customizations) {
      map.set(customization.agentRole, customization.customInstructions);
    }
    return map;
  }, [customizations]);

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Agent Instructions
      </p>
      <p className="text-[11px] text-muted-foreground">
        Add extra instructions on top of each built-in agent's default behavior for this project.
        These are appended, never replacing the agent's required role or output format.
      </p>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading agent instructions...</p>
      ) : (
        <div className="space-y-1.5">
          {AGENT_CATALOG.map((entry) =>
            entry.customizable ? (
              <CustomizableAgentRow
                key={entry.role}
                projectId={projectId}
                role={entry.role as CustomizableAgentRole}
                label={entry.label}
                stage={STAGE_LABELS[entry.stage]}
                description={entry.description}
                limitations={entry.limitations}
                savedInstructions={savedByRole.get(entry.role) ?? ""}
              />
            ) : (
              <div
                key={entry.role}
                className="space-y-1 rounded border border-border bg-background/20 px-2 py-2 opacity-80"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge size="sm" variant="outline">
                    {STAGE_LABELS[entry.stage]}
                  </Badge>
                  <Badge size="sm" variant="agent">
                    {entry.label}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">{entry.description}</p>
                <p className="text-[11px] text-muted-foreground">
                  {entry.nonCustomizableReason ?? entry.limitations}
                </p>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
