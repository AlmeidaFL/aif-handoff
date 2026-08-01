import { Hono } from "hono";
import { AGENT_CATALOG, isCustomizableAgentRole, logger } from "@aif/shared";
import {
  findProjectById,
  listAgentCustomizationResponses,
  toAgentCustomizationResponse,
  upsertAgentCustomization,
} from "@aif/data";
import { upsertAgentCustomizationSchema } from "../schemas.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { jsonValidator } from "../middleware/zodValidator.js";

const log = logger("agent-customization-route");

const mutationRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

export const agentCustomizationsRouter = new Hono();

// GET /agent-customizations/:projectId
agentCustomizationsRouter.get("/:projectId", async (c) => {
  const { projectId } = c.req.param();
  const project = findProjectById(projectId);
  if (!project) return c.json({ error: "Project not found" }, 404);

  return c.json(listAgentCustomizationResponses(projectId));
});

// PUT /agent-customizations/:projectId/:agentRole
agentCustomizationsRouter.put(
  "/:projectId/:agentRole",
  mutationRateLimit,
  jsonValidator(upsertAgentCustomizationSchema),
  async (c) => {
    const { projectId, agentRole } = c.req.param();
    const project = findProjectById(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);

    if (!isCustomizableAgentRole(agentRole)) {
      return c.json(
        {
          error: "Unknown or non-customizable agent role",
          customizableRoles: AGENT_CATALOG.filter((entry) => entry.customizable).map(
            (entry) => entry.role,
          ),
        },
        400,
      );
    }

    const { customInstructions } = c.req.valid("json");
    const row = upsertAgentCustomization({ projectId, agentRole, customInstructions });
    log.debug({ projectId, agentRole }, "[agent-customization-route] Upserted agent customization");
    return c.json(toAgentCustomizationResponse(row));
  },
);
