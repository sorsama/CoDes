import { describe, expect, it } from "vitest";
import { validateWorkspaceIcon, workspaceInitials } from "./workspaceIcon";

describe("workspace icons", () => {
  it("accepts supported local image formats", () => {
    expect(() => validateWorkspaceIcon({ type: "image/png", size: 1024 })).not.toThrow();
    expect(() => validateWorkspaceIcon({ type: "image/jpeg", size: 1024 })).not.toThrow();
    expect(() => validateWorkspaceIcon({ type: "image/webp", size: 1024 })).not.toThrow();
  });

  it("rejects unsupported or oversized files", () => {
    expect(() => validateWorkspaceIcon({ type: "image/svg+xml", size: 1024 })).toThrow(/PNG/);
    expect(() => validateWorkspaceIcon({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toThrow(/5 MB/);
  });

  it("creates compact fallback initials", () => {
    expect(workspaceInitials("Banno Lab")).toBe("BL");
    expect(workspaceInitials("CoDes")).toBe("CO");
    expect(workspaceInitials(" ")).toBe("WS");
  });
});
