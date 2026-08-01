import { describe, it, expect } from "vitest";
import {
  AGENT_CATALOG,
  CUSTOMIZABLE_AGENT_ROLES,
  isCustomizableAgentRole,
} from "../agentCatalog.js";

describe("agentCatalog", () => {
  it("marks every entry in CUSTOMIZABLE_AGENT_ROLES as customizable in the catalog", () => {
    for (const role of CUSTOMIZABLE_AGENT_ROLES) {
      const entry = AGENT_CATALOG.find((e) => e.role === role);
      expect(entry, `expected a catalog entry for role "${role}"`).toBeDefined();
      expect(entry?.customizable).toBe(true);
    }
  });

  it("gives every non-customizable entry a nonCustomizableReason", () => {
    for (const entry of AGENT_CATALOG) {
      if (!entry.customizable) {
        expect(entry.nonCustomizableReason, `expected a reason for "${entry.role}"`).toBeTruthy();
      }
    }
  });

  it("isCustomizableAgentRole accepts only the customizable roles", () => {
    for (const role of CUSTOMIZABLE_AGENT_ROLES) {
      expect(isCustomizableAgentRole(role)).toBe(true);
    }
    expect(isCustomizableAgentRole("plan-polisher")).toBe(false);
    expect(isCustomizableAgentRole("implement-worker")).toBe(false);
    expect(isCustomizableAgentRole("not-a-real-role")).toBe(false);
  });

  it("has no duplicate roles in the catalog", () => {
    const roles = AGENT_CATALOG.map((entry) => entry.role);
    expect(new Set(roles).size).toBe(roles.length);
  });
});
